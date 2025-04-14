const express = require("express");
const router = express.Router();
const mongon = require("@bootloader/mongon");
const DeviceTokenSchema = require("../models/DeviceToken");
const apn = require("apn");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
const fs = require("fs");
const CompanySchema = require("../models/Company");
const multer = require("multer");
const upload = multer({ dest: "configs/uploads/" }); // path provided by devOps

/**
 * Register a new platform for an app
 * @route POST /register-platform
 * @param {string} app_name - Name of the app (required for new apps)
 * @param {string} app_id - ID of existing app (required for existing apps)
 * @param {string} platform_type - Type of platform (ios/android/huawei)
 * @param {string} bundle_id - Bundle ID of the app
 * @param {Object} ios - iOS specific configuration
 * @param {string} ios.key_id - Key ID for iOS platform
 * @param {string} ios.team_id - Team ID for iOS platform
 * @returns {Object} Platform registration details
 * @throws {400} If required parameters are missing
 * @throws {404} If app_id is invalid
 */
router.post("/register-platform", async (req, res) => {
  const { app_name, app_id, platform_type, bundle_id, ios } = req.body;

  // Validate that either app_name or app_id is provided
  if (!app_name && !app_id) {
    return res.status(400).json({
      error: "Either app_name or app_id is required",
    });
  }

  if (!platform_type || !bundle_id) {
    return res.status(400).json({
      error: "Platform type and bundle ID are required",
    });
  }

  if (platform_type === "ios" && (!ios?.key_id || !ios?.team_id)) {
    return res.status(400).json({
      error: "Key ID and Team ID are required for iOS platform",
    });
  }

  try {
    const Company = mongon.model(CompanySchema);
    let company;
    if (app_id) {
      // Find existing company by app_id (company_id in DB)
      company = await Company.findOne({ company_id: app_id });
      if (!company) {
        return res.status(404).json({
          error: "No company found with the provided app_id",
        });
      }
    } else {
      // Create new company with app_name
      company = await Company.findOne({ company_name: app_name });
      if (company) {
        return res.status(400).json({
          error: "App name already exists. Please use the app_id instead",
        });
      }

      company = new Company({
        company_name: app_name,
        company_id: `${app_name}_${Date.now()}`,
        platforms: [],
      });
    }

    // Set app_id if this is the first platform
    if (!company.app_id) {
      company.app_id = bundle_id;
    }

    // Generate platform_id
    const platform_id = `${company.company_id}_${platform_type}_${Date.now()}`;

    // Add platform
    company.platforms.push({
      platform_id,
      platform_type,
      bundle_id,
      key_id: ios?.key_id,
      team_id: ios?.team_id,
    });

    await company.save();

    res.status(200).json({
      success: true,
      company_id: company.company_id,
      platform_id,
      app_id: company.app_id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to register platform" });
  }
});

/**
 * Upload platform-specific configuration file
 * @route POST /upload-platform-file
 * @param {string} app_id - ID of the app
 * @param {string} platform_id - ID of the platform
 * @param {File} platform_file - Configuration file (p8 for iOS, JSON for Android/Huawei)
 * @returns {Object} File upload status and path
 * @throws {400} If required parameters are missing
 * @throws {404} If app or platform not found
 */
router.post("/upload-platform-file", upload.single("platform_file"), async (req, res) => {
  const { app_id, platform_id } = req.body;

  if (!app_id || !platform_id || !req.file) {
    return res.status(400).json({
      error: "App ID, platform ID, and file are required",
    });
  }

  try {
    // Find company using app_id (which is company_id in DB)
    const Company = mongon.model(CompanySchema);
    const company = await Company.findOne({ company_id: app_id });
    if (!company) {
      return res.status(404).json({ error: "App not found" });
    }

    const platform = company.platforms.find((p) => p.platform_id === platform_id);
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" });
    }

    // Create directory structure
    const platformDir = path.join("docs", app_id, platform.platform_type);
    if (!fs.existsSync(platformDir)) {
      fs.mkdirSync(platformDir, { recursive: true });
    }

    // Determine file extension based on platform
    const fileExtension = platform.platform_type === "ios" ? "p8" : "json";
    const fileName = `${platform_id}.${fileExtension}`;
    const filePath = path.join(platformDir, fileName);

    // Move uploaded file
    fs.renameSync(req.file.path, filePath);

    // Update platform with file path
    platform.file_path = filePath;
    await company.save();

    res.status(200).json({
      success: true,
      file_path: filePath,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to upload platform file" });
  }
});

/**
 * Register a device token for push notifications
 * @route POST /register
 * @param {string} device_id - Unique identifier for the device
 * @param {string} token - FCM/APNS token
 * @param {string} platform - Platform type (ios/android/huawei)
 * @param {string} app_id - ID of the app
 * @returns {Object} Registration status and session ID
 * @throws {400} If required parameters are missing
 */
router.post("/register", async (req, res) => {
  const { device_id, token, platform, company_id } = req.body;
  console.log(req.body);

  if (!device_id || !token || !platform || !company_id) {
    return res.status(400).json({ error: "Device ID, Company ID, token, and platform are required" });
  }

  try {
    // Check if device token already exists
    const DeviceToken = mongon.model(DeviceTokenSchema);
    let deviceToken = await DeviceToken.findOne({ device_id });

    if (deviceToken) {
      // Update existing token and session timestamp
      deviceToken.token = token;
      deviceToken.last_active = Date.now();
    } else {
      // Create a new session ID for pre-login user
      const sessionId = crypto.randomBytes(16).toString("hex");

      // Save a new DeviceToken document with a unique session ID
      deviceToken = new DeviceToken({
        device_id,
        token,
        platform,
        company_id: company_id,
        session_id: sessionId,
      });
    }

    await deviceToken.save();
    res.status(200).json({ success: true, session_id: deviceToken.session_id });
  } catch (error) {
    res.status(500).json({ error: "Failed to register device token", details: error.message });
  }
});

/**
 * Associate a user with a registered device
 * @route POST /register/user
 * @param {string} device_id - Device identifier
 * @param {string} user_id - User identifier
 * @param {string} app_id - ID of the app
 * @returns {Object} Registration status and session ID
 * @throws {400} If required parameters are missing or device not found
 */
router.post("/register/user", async (req, res) => {
  const { device_id, user_id, company_id } = req.body;
  console.log(req.body);
  if (!device_id || !user_id) {
    return res.status(400).json({ error: "Device ID and user ID are required" });
  }

  try {
    // Find the device token by device ID
    const DeviceToken = mongon.model(DeviceTokenSchema);
    const deviceToken = await DeviceToken.findOne({ device_id: device_id, company_id: company_id });

    if (deviceToken) {
      // Update the session to associate with the logged-in user
      deviceToken.user_id = user_id;
      deviceToken.status = true;
      deviceToken.last_active = Date.now();
      await deviceToken.save();

      res.status(200).json({ success: true, session_id: deviceToken.session_id });
    } else {
      res.status(400).json({ error: "Device ID not found. Please register the device token first." });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update session", details: error.message });
  }
});

/**
 * Mark a device as logged out
 * @route POST /logout
 * @param {string} device_id - Device identifier
 * @param {string} user_id - User identifier
 * @param {string} app_id - ID of the app
 * @returns {Object} Logout status
 * @throws {400} If required parameters are missing or device not found
 */
router.post("/logout", async (req, res) => {
  const { device_id, user_id, company_id } = req.body;
  console.log(req.body);
  if (!device_id || !user_id) {
    return res.status(400).json({ error: "Device ID and user ID are required" });
  }

  try {
    // Find the device token by device ID
    const DeviceToken = mongon.model(DeviceTokenSchema);
    const deviceToken = await DeviceToken.findOne({ device_id: device_id, company_id: company_id });

    if (deviceToken) {
      // Update the session to associate with the logged-in user
      deviceToken.user_id = user_id;
      deviceToken.status = false;
      await deviceToken.save();

      res.status(200).json({ success: true, session_id: deviceToken.session_id });
    } else {
      res.status(400).json({ error: "Device ID not found. Please register the device token first." });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to update session", details: error.message });
  }
});

router.post("/send-notification", async (req, res) => {
  const { token, title, message, platform, company_id, bundle_id, image_url, category } = req.body;

  if (!token || !message || !platform || !company_id) {
    return res.status(400).json({ error: "Token, message, platform, and company_id are required" });
  }

  try {
    const Company = mongon.model(CompanySchema);
    const company = await Company.findOne({ company_id });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Find the platform configuration
    const platformConfig = company.platforms.find((p) => p.platform_type === platform && p.bundle_id === bundle_id);
    if (!platformConfig) {
      return res.status(404).json({ error: "Platform configuration not found" });
    }

    // Get the platform-specific file path
    const platformDir = path.join(__dirname, "..", "docs", company_id, platform);
    const fileName = `${platformConfig.platform_id}.${platform === "ios" ? "p8" : "json"}`;
    const configFilePath = path.join(platformDir, fileName);

    if (platform === "ios") {
      const apnProvider = new apn.Provider({
        token: {
          key: configFilePath,
          keyId: platformConfig.key_id,
          teamId: platformConfig.team_id,
        },
        production: true,
      });

      const notification = new apn.Notification();
      notification.alert = message;
      notification.sound = "default";
      notification.topic = bundle_id;
      if (category) notification.category = category;
      if (image_url) {
        notification.mutableContent = 1;
        notification.payload = { "media-url": image_url };
      }

      const result = await apnProvider.send(notification, token);
      apnProvider.shutdown();
      return res.status(200).json({ success: true, result });
    } else if (platform === "android") {
      const firebaseApp = admin.initializeApp(
        {
          credential: admin.credential.cert(require(configFilePath)),
        },
        `app_${company_id}_${Date.now()}`
      );

      const messageData = {
        token: token,
        notification: {
          title: title,
          body: message,
          image: image_url || undefined,
        },
      };

      const result = await firebaseApp.messaging().send(messageData);
      admin.app(`app_${company_id}_${Date.now()}`).delete();
      return res.status(200).json({ success: true, result });
    } else if (platform === "huawei") {
      const huaweiKeyFile = require(configFilePath);
      const result = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);
      return res.status(200).json({ success: true, result });
    }

    return res.status(400).json({ error: "Invalid platform" });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to send notification",
      details: error.message,
    });
  }
});

/**
 * Send notification to a specific user's devices
 * @route POST /send-notification-by-user
 * @param {string} profile_code - User's profile code
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} app_id - ID of the app
 * @param {string} [bundle_id] - Bundle ID of the app
 * @param {string} [image_url] - URL of the notification image
 * @param {string} [category] - Notification category
 * @param {Object} [filter] - Optional filters
 * @param {string} [filter.platform] - Space-separated platforms (e.g., "android ios")
 * @param {string} [filter.session_type] - Session type ("user" or "guest")
 * @returns {Object} Notification delivery status and details
 * @throws {400} If required parameters are missing
 * @throws {404} If app not found or no matching devices
 */
router.post("/send-notification-by-user", async (req, res) => {
  const { profile_code, title, message, bundle_id, image_url, app_id, category, filter } = req.body;

  if (!profile_code || !message || !app_id) {
    return res.status(400).json({ error: "Profile code, message, and app_id are required" });
  }

  try {
    // Find company using app_id (which is company_id in DB)
    const Company = mongon.model(CompanySchema);
    const company = await Company.findOne({ company_id: app_id });
    if (!company) {
      return res.status(404).json({ error: "App not found" });
    }

    // Build query for device tokens
    const query = {
      user_id: profile_code,
      company_id: app_id, // Using app_id here as well
      status: true,
    };

    // Handle platform filter
    if (filter?.platform) {
      const platforms = filter.platform.split(" ");
      query.platform = { $in: platforms };
    }

    // Handle session type filter
    if (filter?.session_type) {
      if (filter.session_type === "user") {
        query.user_id = { $exists: true, $ne: null };
      } else if (filter.session_type === "guest") {
        query.user_id = { $exists: false };
      }
    }

    // Find all active device tokens based on filters
    const DeviceToken = mongon.model(DeviceTokenSchema);
    const deviceRecords = await DeviceToken.find(query);

    if (!deviceRecords || deviceRecords.length === 0) {
      return res.status(404).json({ error: "No active devices found matching the criteria" });
    }

    const responses = [];

    // Send notifications to all devices
    for (const device of deviceRecords) {
      const { platform, token } = device;

      try {
        // Find the platform configuration
        const platformConfig = company.platforms.find((p) => p.platform_type === platform);
        if (!platformConfig) {
          responses.push({
            platform,
            token,
            error: "Platform configuration not found",
            status: "failed",
          });
          continue;
        }

        // Get the platform-specific file path
        const platformDir = path.join(__dirname, "..", "docs", app_id, platform);
        const fileName = `${platformConfig.platform_id}.${platform === "ios" ? "p8" : "json"}`;
        const configFilePath = path.join(platformDir, fileName);

        if (platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
              key: configFilePath,
              keyId: platformConfig.key_id,
              teamId: platformConfig.team_id,
            },
            production: true,
          });

          const notification = new apn.Notification();
          notification.alert = message;
          notification.sound = "default";
          notification.topic = platformConfig.bundle_id;
          if (category) notification.category = category;
          if (image_url) {
            notification.mutableContent = 1;
            notification.payload = { "media-url": image_url };
          }

          const result = await apnProvider.send(notification, token);
          responses.push({ platform: "ios", token, result });
          apnProvider.shutdown();
        } else if (platform === "android") {
          const firebaseApp = admin.initializeApp(
            {
              credential: admin.credential.cert(require(configFilePath)),
            },
            `app_${app_id}_${token}`
          );

          const messageData = {
            token: token,
            notification: {
              title: title,
              body: message,
              image: image_url || undefined,
            },
          };

          const result = await firebaseApp.messaging().send(messageData);
          responses.push({ platform: "android", token, result });
          admin.app(`app_${app_id}_${token}`).delete();
        } else if (platform === "huawei") {
          const huaweiKeyFile = require(configFilePath);
          const result = await sendHuaweiNotification(huaweiKeyFile, token, title, message, image_url);
          responses.push({ platform: "huawei", token, result });
        }
      } catch (error) {
        responses.push({
          platform,
          token,
          error: error.message,
          status: "failed",
        });
      }
    }

    // Check if any notifications were sent successfully
    const successfulNotifications = responses.filter((r) => !r.error);
    if (successfulNotifications.length === 0) {
      return res.status(500).json({
        error: "Failed to send notifications to all devices",
        details: responses,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Notifications sent to ${successfulNotifications.length} devices`,
      failed: responses.length - successfulNotifications.length,
      responses,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to process notification request",
      details: error.message,
    });
  }
});

/**
 * Send bulk notifications to multiple devices
 * @route POST /send-notification-bulk
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} app_id - ID of the app
 * @param {string} [bundle_id] - Bundle ID of the app
 * @param {string} [image_url] - URL of the notification image
 * @param {string} [category] - Notification category
 * @param {Object} [filter] - Optional filters
 * @param {string} [filter.platform] - Space-separated platforms (e.g., "android ios")
 * @param {string} [filter.session_type] - Session type ("user" or "guest")
 * @returns {Object} Notification delivery status and details
 * @throws {400} If required parameters are missing
 * @throws {404} If app not found or no matching devices
 */
router.post("/send-notification-bulk", async (req, res) => {
  const { title, message, app_id, bundle_id, image_url, category, filter } = req.body;

  if (!message || !title || !app_id) {
    return res.status(400).json({ error: "Title, message, and app_id are required" });
  }

  try {
    // Find company using app_id (which is company_id in DB)
    const Company = mongon.model(CompanySchema);
    const company = await Company.findOne({ company_id: app_id });
    if (!company) {
      return res.status(404).json({ error: "App not found" });
    }

    // Build query for device tokens
    const query = {
      company_id: app_id, // Using app_id here as well
      status: true,
    };

    // Handle platform filter
    if (filter?.platform) {
      const platforms = filter.platform.split(" ");
      query.platform = { $in: platforms };
    }

    // Handle session type filter
    if (filter?.session_type) {
      if (filter.session_type === "user") {
        query.user_id = { $exists: true, $ne: null };
      } else if (filter.session_type === "guest") {
        query.user_id = { $exists: false };
      }
    }

    // Get device tokens based on filters
    const DeviceToken = mongon.model(DeviceTokenSchema);
    const deviceTokens = await DeviceToken.find(query);

    if (deviceTokens.length === 0) {
      return res.status(404).json({ error: "No active devices found matching the criteria" });
    }

    const responses = [];

    for (const device of deviceTokens) {
      try {
        const devicePlatformConfig = platform
          ? platformConfig
          : company.platforms.find((p) => p.platform_type === device.platform);

        if (!devicePlatformConfig) {
          responses.push({
            platform: device.platform,
            token: device.token,
            error: "Platform configuration not found",
            status: "failed",
          });
          continue;
        }

        const platformDir = path.join(__dirname, "..", "docs", app_id, device.platform);
        const fileName = `${devicePlatformConfig.platform_id}.${device.platform === "ios" ? "p8" : "json"}`;
        const configFilePath = path.join(platformDir, fileName);

        if (device.platform === "ios") {
          const apnProvider = new apn.Provider({
            token: {
              key: configFilePath,
              keyId: devicePlatformConfig.key_id,
              teamId: devicePlatformConfig.team_id,
            },
            production: true,
          });

          const notification = new apn.Notification();
          notification.alert = message;
          notification.sound = "default";
          notification.topic = devicePlatformConfig.bundle_id;
          if (category) notification.category = category;
          if (image_url) {
            notification.mutableContent = 1;
            notification.payload = { "media-url": image_url };
          }

          const result = await apnProvider.send(notification, device.token);
          responses.push({ platform: "ios", token: device.token, result });
          apnProvider.shutdown();
        } else if (device.platform === "android") {
          const firebaseApp = admin.initializeApp(
            {
              credential: admin.credential.cert(require(configFilePath)),
            },
            `app_${app_id}_${device.token}`
          );

          const messageData = {
            token: device.token,
            notification: {
              title: title,
              body: message,
              image: image_url || undefined,
            },
          };

          const result = await firebaseApp.messaging().send(messageData);
          responses.push({ platform: "android", token: device.token, result });
          admin.app(`app_${app_id}_${device.token}`).delete();
        } else if (device.platform === "huawei") {
          const huaweiKeyFile = require(configFilePath);
          const result = await sendHuaweiNotification(huaweiKeyFile, device.token, title, message, image_url);
          responses.push({ platform: "huawei", token: device.token, result });
        }
      } catch (error) {
        responses.push({
          platform: device.platform,
          token: device.token,
          error: error.message,
          status: "failed",
        });
      }
    }
    console.log(responses);
    // Return results
    const successfulNotifications = responses.filter((r) => !r.error);
    return res.status(200).json({
      success: true,
      message: `Notifications sent to ${successfulNotifications.length} devices`,
      failed: responses.length - successfulNotifications.length,
      responses,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to send bulk notifications",
      details: error.message,
    });
  }
});

/**
 * Helper function to send iOS notifications
 * @private
 * @param {Object} config - iOS configuration
 * @param {string} token - Device token
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} Send result
 */
async function sendIOSNotification(config, token, notification) {
  // ... implementation ...
}

/**
 * Helper function to send Android notifications
 * @private
 * @param {Object} config - Firebase configuration
 * @param {string} token - Device token
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} Send result
 */
async function sendAndroidNotification(config, token, notification) {
  // ... implementation ...
}

/**
 * Helper function to send Huawei notifications
 * @private
 * @param {Object} config - Huawei configuration from JSON file
 * @param {string} token - Device token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} [image_url] - Optional image URL
 * @returns {Promise<Object>} Send result
 */
async function sendHuaweiNotification(config, token, title, message, image_url) {
  try {
    // Huawei Push Kit API endpoint
    const pushkitUrl = true ? "https://push-api.cloud.huawei.com/v1" : "https://push-api-sandbox.cloud.huawei.com/v1";

    // Get access token using client_id and client_secret from config
    const authUrl = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
    const authResponse = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id,
        client_secret: config.client_secret,
      }),
    });

    const authData = await authResponse.json();
    if (!authData.access_token) {
      throw new Error("Failed to get Huawei access token");
    }

    // Prepare notification payload
    const payload = {
      validate_only: false,
      message: {
        token: [token],
        notification: {
          title: title,
          body: message,
        },
        android: {
          notification: {
            title: title,
            body: message,
            click_action: {
              type: 1, // Open app
            },
            style: 0, // Default style
            importance: "HIGH",
          },
        },
        data: {
          // Add any custom data here
          type: "notification",
          timestamp: Date.now().toString(),
        },
      },
    };

    // Add image if provided
    if (image_url) {
      payload.message.android.notification.image = image_url;
    }

    // Send notification
    const pushResponse = await fetch(`${pushkitUrl}/${config.app_id}/messages:send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authData.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    const pushResult = await pushResponse.json();

    if (pushResult.code && pushResult.code !== "80000000") {
      throw new Error(`Huawei Push Kit error: ${pushResult.msg}`);
    }

    return {
      success: true,
      messageId: pushResult.requestId,
      response: pushResult,
    };
  } catch (error) {
    console.error("Huawei notification error:", error);
    throw new Error(`Failed to send Huawei notification: ${error.message}`);
  }
}

module.exports = {
  path: "/pushapp",
  router: router,
};
