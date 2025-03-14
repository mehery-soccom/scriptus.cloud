import express from "express";
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { decorators } from "@bootloader/core";
import { redis, waitForReady } from "@bootloader/redison";
import { Queue, Worker } from "bullmq";
import crypto from "crypto";
const coreutils = require("./utils/coreutils");

const BATCH_SIZE = 10;
const MAX_WORKERS = 5;
const RETRY_DELAY = 5000;
const jobHolders = {};

async function initJobs({ name, path }) {
  coreutils.log(`initJobs`);
  const router = express.Router();

  // Load controllers from the "controllers" directory
  const jobsPath = join(process.cwd(), `${path}/workers`);
  let controllerFiles = [];
  if (existsSync(jobsPath)) {
    controllerFiles = readdirSync(jobsPath).filter((file) => file.endsWith(".js"));
  }
  let client = await waitForReady();

  for (const file of controllerFiles) {
    const { default: JobClass } = require(join(jobsPath, file));

    if (!JobClass) continue;

    // Get the last registered controller from the decorators system
    let job = decorators.mappings.jobs.find(JobClass);
    if (!job) continue;

    const jobName = job.meta.name;
    const jobQueueName = `jobs-${jobName}`;
    const taskQueueName = `jobs-${jobName}-tasks`;
    const jobQueue = new Queue(jobQueueName, { connection: client });
    const taskQueue = new Queue(taskQueueName, { connection: client });

    console.log("initJobs", `${path}/jobs`, file, job._routed);

    if (!job._routed) {
      //job._routed = true;
      let jobInstance = new JobClass();

      jobHolders[jobName] = {
        name: jobName,
        job: jobInstance,
      };
      //console.log("jobjobjobjobv", job, JobClass);
      JobClass.start = async function (data, options = {}) {
        let jobId = options.jobId || crypto.randomUUID();
        //console.log(`addJob(jobId:${jobId})`)
        await jobQueue.add("read", data, {
          jobId: jobId,
          removeOnComplete: {
            age: 3600, // keep up to 1 hour
            count: 100, // keep up to 100 jobs
          },
          removeOnFail: {
            age: 24 * 3600, // keep up to 1 hour
            count: 500, // keep up to 1000 jobs
          },
          ...options,
        });
      };

      JobClass.task = async function (data, taskOptions = {}, options = {}) {
        if (taskOptions.queue) {
          taskOptions.queue = taskOptions.queue;
          //console.log(`addJob(jobId:${jobId})`)
          if (data) {
            await redis.rpush(taskOptions.queue, JSON.stringify(data));
          } else {
            //console.log(`No data to queue(${taskOptions.queue}) !!`);
          }
          let task = await taskQueue.add("queueTask", taskOptions, {
            jobId: taskOptions.queue, //use queue as id to create uniquness
            removeOnComplete: true,
            removeOnFail: true,
            ...options,
          });
          if (task) {
            //console.log(`✅ Task added successfully: Id:${task.id}`);
          } else {
            //console.log("❌ Failed to add task");
          }
        } else {
          await taskQueue.add("execute", data, {
            ...taskOptions,
            jobId: crypto.randomUUID(),
            removeOnComplete: true,
            removeOnFail: {
              age: 3600, // keep up to 1 hour
              count: 1000, // keep up to 1000 jobs
            },
            ...options,
          });
        }
      };

      let workers = job.workers || MAX_WORKERS;
      let delay = job.delay || RETRY_DELAY;

      // Setup Worker to Fetch Tasks

      if (typeof jobInstance.run == "function") {
        new Worker(
          jobQueueName,
          async (job) => {
            try {
              const pendingTaskCount = await taskQueue.count();
              if (pendingTaskCount < workers * 2) {
                let pushedTask = [];
                let retTasks = await jobInstance.run(job.data, {
                  task(...tasks) {
                    pushedTask = [...pushedTask, ...tasks];
                  },
                });

                if (Array.isArray(retTasks)) {
                  pushedTask = [...pushedTask, ...retTasks].filter(function (task) {
                    return !!task;
                  });
                }
                if (pushedTask && pushedTask.length) {
                  console.log("Total Tasks", pushedTask.length);
                  for (let task of pushedTask) {
                    if (task) await JobClass.task(task);
                  }
                  await JobClass.start(job.data, { delay: 1000, jobId: job.id });
                } else {
                  console.log(`No Task!! Job Finished.!!`);
                }
              } else {
                console.log(`Queue full, delaying ${job.id}`);
                await JobClass.start(job.data, { delay: delay, jobId: job.id });
              }
            } catch (e) {
              console.error(e);
            }
          },
          { connection: client }
        );
      }

      if (typeof jobInstance.execute == "function") {
        // Setup Worker to Execute Tasks
        new Worker(
          taskQueueName,
          async (task) => {
            try {
              let taskOptions = { id: task.id };
              if ("queueTask" == task.name) {
                taskOptions.queue = task.id; //use id as queue
                const message = await redis.lpop(taskOptions.queue);
                if (message) {
                  let data = JSON.parse(message);
                  await jobInstance.execute(data, taskOptions);
                  setTimeout(async () => {
                    const state = await task.getState();
                    if (state === "completed" || state === "failed" || state === "delayed") {
                      // If the job is not locked, safely remove it
                      await task.remove();
                      //console.log(`✅ Task ${task.id} removed successfully`);
                    } else {
                      //console.log(`❌ Task ${task.id} is in progress, cannot remove while locked`);
                    }
                    await JobClass.task(null, taskOptions);
                  }, 500);
                } else {
                  //console.log(`No Task in queue(${task.data.queue}) !!`);
                }
              } else {
                await jobInstance.execute(task.data, taskOptions);
              }
              //await task.moveToCompleted(); //
              //await task.remove(); // Now safe to remove
            } catch (e) {
              console.error(e);
            }
          },
          { concurrency: workers, connection: client, removeOnComplete: true, removeOnFail: true }
        );
      }

      async function recoverJobs() {
        console.log("Recovering delayed jobs...");
        const delayedJobs = await jobQueue.getDelayed();
        for (const job of delayedJobs) {
          let delayLeft = 0;
          if (job.timestamp && job?.opts?.delay) {
            const now = Date.now();
            delayLeft = Math.max(delayLeft, job.timestamp + job.opts.delay - now);
          }
          console.log(`Re-adding job ${job.id} (was delayed :${delayLeft})`);
          await jobQueue.add("read", job.data, { delay: delayLeft }); // Re-add immediately
        }
        // Recovering delayed tasks
        console.log("Recovering delayed tasks...");
        const delayedTasks = await taskQueue.getDelayed();
        for (const task of delayedTasks) {
          let delayLeft = 0;
          if (task.timestamp && task?.opts?.delay) {
            const now = Date.now();
            delayLeft = Math.max(delayLeft, task.timestamp + task.opts.delay - now);
          }
          console.log(`Re-adding task ${task.id} (was delayed :${delayLeft} )`);
          await taskQueue.add("execute", task.data, { delay: delayLeft }); // Re-add immediately
        }
      }

      recoverJobs();
    }
  }
  initQueues(name);
}

async function initQueues(app) {
  let client = await waitForReady();
  for (const { name, job } of Object.values(jobHolders)) {
    try {
      if (typeof job.poll == "function") {
        await executeOnQueue(app, name, job);
        await executeOnQueue("*", name, job);
      }
    } catch (error) {
      coreutils.error("Queue processing error:", error);
    }
  }
  setTimeout(() => initQueues(app), 1000);
}

async function executeOnQueue(app, topic, job) {
  let queueName = `eq:app:${app}:topic:${topic}`;
  const message = await redis.rpop(queueName); // Non-Blocking call
  if (message) {
    let event = JSON.parse(message);
    coreutils.log(`Processed in Node.js ${queueName}: (${event})`);
    job.poll(event.data, {});
  }
}

export { initJobs };
