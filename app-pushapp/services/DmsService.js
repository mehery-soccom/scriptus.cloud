const fetch = require("node-fetch");
const fs = require("node:fs");
const path = require("path");
const config = require("@bootloader/config");
const console = require("@bootloader/log4js").getLogger("DmsService");
const AWS = require("aws-sdk");
const S3 = new AWS.S3({
  accessKeyId: config.getIfPresent("aws.s3.b1.accessKey"),
  secretAccessKey: config.getIfPresent("aws.s3.b1.secretKey"),
});
const LOCAL_PATH = `configs/downloads/certs`;
const S3_PATH = `/pushapp/channels/certs`;

const Dms = {};

Dms.save = async function ({ file, name }) {
  try {
    const fileStream = fs.createReadStream(file.path); // use path.join ?
    const uploadParams = {
      Bucket: config.getIfPresent("aws.s3.b1.bucket"),
      Key: `${S3_PATH}/${name}`,
      Body: fileStream,
      ContentType: file.mimetype,
    };
    const remoteUploadDetails = await S3.upload(uploadParams).promise();
    console.log(`uploaded to S3: `, remoteUploadDetails);

    return remoteUploadDetails;
  } catch (error) {
    console.error("save", error);
    throw error;
  }
};

Dms.certs = {
  async save({ file, name }) {
    // save on AWS
    // save locally
    try {
      const remoteDetails = await Dms.save({ file, name });
      const localDetails = await writeFile(file, name, LOCAL_PATH);

      return {
        name,
        remotePath: remoteDetails?.Location,
        localPath: localDetails?.Location,
      };
    } catch (error) {
      console.error("certs.save", error);
      throw error;
    }
  },
  async get({ remotePath }) {
    // check if exists locally ? return : download from remote & return
    try {
      let localPath;

      const fileName = remotePath.split("/").pop();

      const fileExists = fs.existsSync(`${LOCAL_PATH}/${fileName}`); // use path.join ?

      if (fileExists) {
        console.log("file exists");

        localPath = `${LOCAL_PATH}/${fileName}`; // use path.join ?
      } else {
        console.log("file does not exists");

        const details = await downloadFile(remotePath, LOCAL_PATH);
        localPath = details.Location;
      }

      return {
        localPath,
      };
    } catch (error) {
      console.error("certs.get", error);
    }
  },
};

async function writeFile(file, name, _path) {
  try {
    const tempPath = file.path;

    const targetPath = `${_path}/${name}`; // use path.join ?

    fs.mkdirSync(_path, { recursive: true }); // use path.join ?

    fs.renameSync(tempPath, targetPath);

    console.log(`File written successfully to ${targetPath}`);

    return {
      Location: targetPath,
    };
  } catch (error) {
    console.error("Error writing file:", error);
    throw error;
  }
}

async function downloadFile(url, _path) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const fileName = url.split("/").pop();

    const targetPath = `${_path}/${fileName}`; // use path.join ?

    fs.mkdirSync(_path, { recursive: true }); // use path.join ?

    const fileStream = fs.createWriteStream(targetPath);

    return new Promise((resolve, reject) => {
      response.body.pipe(fileStream);

      response.body.on("error", (err) => {
        reject(err);
      });

      fileStream.on("finish", () => {
        console.log(`File downloaded successfully to ${targetPath}`);

        resolve({
          Location: targetPath,
        });
      });
    });
  } catch (error) {
    console.error("Error downloading file:", error);
    throw error;
  }
}

module.exports = Dms;
