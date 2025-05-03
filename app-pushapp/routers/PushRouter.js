const express = require("express");
const router = express.Router();
const mongon = require("@bootloader/mongon");
const DeviceTokenSchema = require("../models/DeviceToken");
const apn = require("apn");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");
const fs = require("fs");
const fetch = require("node-fetch");
const ChannelsSchema = require("../models/Channels");
const multer = require("multer");
const upload = multer({ dest: "configs/uploads/" }); // path provided by devOps
const ChannelHistorySchema = require("../models/ChannelHistory");
const NotificationHistorySchema = require("../models/NotificationHistory");
const { context } = require("@bootloader/utils");
const Dms = require("../services/DmsService");

// First, let's add a helper function at the top of the file to make the code cleaner
function getModel(Schema) {
  console.log("Tenant: ", context.getTenant());
  return mongon.model(Schema, { dbDomain: context.getTenant() });
}

/**
 * Send notification via APNS (Apple Push Notification Service)
 * @param {string} certPath - Path to p8 certificate file
 * @param {string} keyId - Apple Key ID
 * @param {string} teamId - Apple Team ID
 * @param {string} bundleId - App Bundle ID
 * @param {string} token - Device token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} [imageUrl] - Optional image URL
 * @param {string} [category] - Notification category
 * @param {Object[]} [buttons] - Array of button objects
 * @returns {Promise<Object>} Notification result
 */
async function sendApnsNotification(certPath, keyId, teamId, bundleId, token, title, message, imageUrl, category, buttons) {
  try {
    const options = {
      token: {
        key: certPath,
        keyId: keyId,
        teamId: teamId
      },
      production: true
    };

    const apnProvider = new apn.Provider(options);
    const notification = new apn.Notification();

    // Basic notification setup
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.sound = "default";
    notification.alert = {
      title: title,
      body: message
    };
    notification.topic = bundleId;

    // Create the custom payload
    let customPayload = {};

    // Add buttons if provided
    if (buttons && buttons.length > 0) {
      notification.category = category;
      customPayload = {
        ...customPayload,
        aps: {
          alert: {
            title: title,
            body: message
          },
          sound: "default",
          category: category,
          "mutable-content": 1,
          "content-available": 1
        },
        buttons: buttons.map(button => ({
          id: button.button_id,
          title: button.button_text,
          url: button.button_url
        }))
      };
    }

    // Add image if provided
    if (imageUrl) {
      notification.mutableContent = 1;
      customPayload = {
        ...customPayload,
        'media-url': imageUrl,
        'content-available': 1,
        'mutable-content': 1
      };
    }

    // Set the final payload
    notification.payload = customPayload;
    notification.badge = 1;

    // For debugging
    console.log('APNS Notification Payload:', JSON.stringify({
      aps: notification.aps,
      ...notification.payload
    }, null, 2));

    const result = await apnProvider.send(notification, token);
    apnProvider.shutdown();

    return {
      success: result.sent.length > 0,
      failed: result.failed.length > 0,
      failure_reason: result.failed[0]?.response?.reason,
      notification: {
        aps: notification.aps,
        ...notification.payload
      }
    };
  } catch (error) {
    console.error('APNS Error:', error);
    throw new Error(`APNS Error: ${error.message}`);
  }
}

/**
 * Send notification via FCM (Firebase Cloud Messaging)
 * @param {string} configPath - Path to Firebase config JSON
 * @param {string} token - Device token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} [imageUrl] - Optional image URL
 * @param {string} [category] - Notification category
 * @param {Object[]} [buttons] - Array of button objects
 * @returns {Promise<Object>} Notification result
 */
async function sendFcmNotification(configPath, token, title, message, imageUrl, category, buttons) {
  try {
    const absolutePath = path.resolve(process.cwd(), configPath);
    console.log('Loading FCM config from:', absolutePath);
    
    let serviceAccount;
    try {
      const configFile = fs.readFileSync(absolutePath, 'utf8');
      serviceAccount = JSON.parse(configFile);
    } catch (error) {
      throw new Error(`Failed to read FCM config file: ${error.message}`);
    }

    // Get app name from config path to handle multiple Firebase apps
    const appName = path.basename(configPath, '.json');
    
    // Initialize or get existing Firebase app
    let firebaseApp;
    try {
      firebaseApp = admin.app(appName);
    } catch (error) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      }, appName);
    }

    // Build the notification payload
    const payload = {
      token: token,
      data: {
        id: crypto.randomUUID(), // Generate a unique ID for the notification
        title: title,
        body: message,
        type: "notification",
        category: category || "default",
        image: imageUrl || ""
      }
    };


    // Add buttons to notification if provided
    if (buttons && buttons.length > 0) {
      buttons.forEach((button, index) => {
        const idx = index + 1;
        payload.data[`action${idx}`] = button.button_id;
        payload.data[`title${idx}`] = button.button_text;
        payload.data[`url${idx}`] = button.button_url;
      });

      // Set click_action to first button's action
      // payload.notification.click_action = buttons[0].button_id;
    }

    console.log('FCM Payload:', JSON.stringify(payload, null, 2));

    const result = await firebaseApp.messaging().send(payload);

    return {
      success: true,
      messageId: result,
      payload: payload
    };
  } catch (error) {
    console.error('FCM Error:', error);
    throw new Error(`FCM Error: ${error.message}`);
  }
}

/**
 * Send notification via Huawei Push Kit
 * @param {Object} config - Huawei config from JSON file
 * @param {string} token - Device token
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} [imageUrl] - Optional image URL
 * @returns {Promise<Object>} Notification result
 */
async function sendHuaweiNotification(config, token, title, message, imageUrl) {
  try {
    // Huawei Push Kit API endpoint
    const pushkitUrl = "https://push-api.cloud.huawei.com/v1";

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
          type: "notification",
          timestamp: Date.now().toString(),
        },
      },
    };

    // Add image if provided
    if (imageUrl) {
      payload.message.android.notification.image = imageUrl;
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
    throw new Error(`Huawei Error: ${error.message}`);
  }
}

/**
 * Register a device token for push notifications
 * @route POST /register
 * @param {string} device_id - Unique identifier for the device
 * @param {string} token - FCM/APNS token
 * @param {string} platform - Platform type (ios/android/huawei)
 * @param {string} channel_id - ID of the channel
 * @returns {Object} Registration status and session ID
 * @throws {400} If required parameters are missing
 * @throws {404} If channel not found
 */
router.post("/register", async (req, res) => {
  const { device_id, token, platform, channel_id } = req.body;

  if (!device_id || !token || !platform || !channel_id) {
    return res.status(400).json({ 
      error: "Device ID, Channel ID, token, and platform are required" 
    });
  }

  try {
    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });
    
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const platformExists = channel.platforms.some(p => p.platform_type === platform);
    
    if (!platformExists) {
      return res.status(404).json({ 
        error: `Platform ${platform} not configured for this channel` 
      });
    }

    // Check if device token already exists
    const DeviceToken = getModel(DeviceTokenSchema);
    let deviceToken = await DeviceToken.findOne({ device_id });

    if (deviceToken) {
      // Update existing token and session timestamp
      deviceToken.token = token;
      deviceToken.last_active = Date.now();
      deviceToken.channel_id = channel_id;
    } else {
      // Create a new session ID for pre-login user
      const sessionId = crypto.randomBytes(16).toString("hex");

      // Save a new DeviceToken document
      deviceToken = new DeviceToken({
        device_id,
        token,
        platform,
        channel_id,
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
 * Register a user's device
 * @route POST /register/user
 * @param {string} device_id - Device ID to register
 * @param {string} user_id - User ID to associate with device
 * @param {string} channel_id - ID of the channel
 * @returns {Object} Registration status
 * @throws {400} If required parameters are missing
 * @throws {404} If channel not found
 */
router.post("/register/user", async (req, res) => {
  const { device_id, user_id, channel_id } = req.body;

  if (!device_id || !user_id || !channel_id) {
    return res.status(400).json({ 
      error: "Device ID, User ID, and Channel ID are required" 
    });
  }

  try {
    // Validate channel existence
    const Channels = getModel(ChannelsSchema);
    const tenant = await Channels.findOne({ 
      "channels.channel_id": channel_id
    });

    if (!tenant) {
      return res.status(404).json({ 
        error: "Channel not found" 
      });
    }

    const DeviceToken = getModel(DeviceTokenSchema);
    const deviceToken = await DeviceToken.findOne({ device_id });

    if (!deviceToken) {
      return res.status(404).json({ error: "Device not found" });
    }

    // Update device token with user information
    deviceToken.user_id = user_id;
    deviceToken.channel_id = channel_id;
    deviceToken.last_active = Date.now();

    await deviceToken.save();
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to register user device", details: error.message });
  }
});

/**
 * Mark a device as logged out
 * @route POST /logout
 * @param {string} device_id - Device identifier
 * @param {string} user_id - User identifier
 * @returns {Object} Logout status
 * @throws {400} If required parameters are missing or device not found
 */
router.post("/logout", async (req, res) => {
  const { device_id, user_id } = req.body;

  if (!device_id || !user_id) {
    return res.status(400).json({ error: "Device ID and user ID are required" });
  }

  try {
    const DeviceToken = getModel(DeviceTokenSchema);
    const deviceToken = await DeviceToken.findOne({ device_id });

    if (deviceToken) {
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

// First, let's create a helper function for sending notifications
async function sendNotificationToDevice(token, title, message, platform, channel_id, image_url, category, buttons) {
  const Channels = getModel(ChannelsSchema);
  const channel = await Channels.findOne({ channel_id });
  
  if (!channel) {
    throw new Error("Channel not found");
  }
  
  // Get platform configuration and check active status
  const platformConfig = channel.platforms.find(p => 
    p.platform_type === platform && p.active === true
  );

  if (!platformConfig) {
    throw new Error(`Platform ${platform} not active or not configured for this channel`);
  }

  console.log(platformConfig);

  // Send notification based on platform
  let result;
  if (platform === "ios") {
    const configPath = platformConfig.file_path;
    if (!configPath) {
      throw new Error("iOS certificate not configured");
    }

    result = await sendApnsNotification(
      configPath,
      platformConfig.key_id,
      platformConfig.team_id,
      platformConfig.bundle_id,
      token,
      title,
      message,
      image_url,
      category,
      buttons
    );
  } else if (platform === "android") {
    const configPath = platformConfig.file_path;
    if (!configPath) {
      throw new Error("Android configuration not found");
    }

    result = await sendFcmNotification(
      configPath,
      token,
      title,
      message,
      image_url,
      category,
      buttons
    );
  } else if (platform === "huawei") {
    const configPath = platformConfig.file_path;
    if (!configPath) {
      throw new Error("Huawei configuration not found");
    }

    result = await sendHuaweiNotification(
      require(configPath),
      token,
      title,
      message,
      image_url
    );
  }

  return result;
}

// Now update the send-notification endpoint to use this function
router.post("/send-notification", async (req, res) => {
  const { 
    token, 
    title, 
    message, 
    platform, 
    channel_id,
    image_url,
    category,
    buttons
  } = req.body;

  if (!token || !title || !message || !platform || !channel_id) {
    return res.status(400).json({ 
      error: "Token, title, message, platform, and channel_id are required" 
    });
  }

  // Validate buttons format if provided
  if (buttons) {
    if (!Array.isArray(buttons)) {
      return res.status(400).json({ 
        error: "Buttons must be an array" 
      });
    }
    
    for (const button of buttons) {
      if (!button.button_id || !button.button_text || !button.button_url) {
        return res.status(400).json({ 
          error: "Each button must have button_id, button_text, and button_url" 
        });
      }
    }
  }

  try {
    const result = await sendNotificationToDevice(
      token,
      title,
      message,
      platform,
      channel_id,
      image_url,
      category,
      buttons
    );
    res.status(200).json(result);
  } catch (error) {
    console.error("Failed to send notification:", error);
    res.status(500).json({ error: "Failed to send notification", details: error.message });
  }
});

/**
 * Send notification to all user devices in a channel
 * @route POST /send-notification-by-user
 * @param {string} user_id - User to send notification to
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} channel_id - ID of the channel
 * @param {string} [image_url] - Optional URL for notification image
 * @param {string} [category] - Notification category
 * @param {Object} [filter] - Filter criteria for devices
 * @param {string} [filter.platform] - Space-separated platform types to include
 * @param {string} [filter.session_type] - Filter by session type (user/guest)
 * @returns {Object} Notification send status
 * @throws {400} If required parameters are missing
 * @throws {404} If channel not found
 */
router.post("/send-notification-by-user", async (req, res) => {
  const { 
    user_id, 
    title, 
    message, 
    channel_id,
    image_url,
    category,
    filter 
  } = req.body;

  if (!user_id || !title || !message || !channel_id) {
    return res.status(400).json({ 
      error: "User ID, title, message, and channel_id are required" 
    });
  }

  try {
    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });
    
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Get user's devices with filters
    const DeviceToken = getModel(DeviceTokenSchema);
    let query = { 
      user_id,
      channel_id,
      status: true 
    };

    // Apply platform filter if specified
    if (filter?.platform) {
      const platforms = filter.platform.split(' ');
      query.platform = { $in: platforms };
    }

    // Apply session type filter if specified
    if (filter?.session_type) {
      if (filter.session_type === 'user') {
        query.user_id = { $exists: true };
      } else if (filter.session_type === 'guest') {
        query.user_id = { $exists: false };
      }
    }

    const devices = await DeviceToken.find(query);

    // Send notifications to all matching devices
    const results = await Promise.all(
      devices.map(async device => {
        const platformConfig = channel.platforms.find(p => p.platform_type === device.platform);
        if (!platformConfig) return null;

        try {
          const notificationResult = await router.post("/send-notification").handler({
            body: {
              token: device.token,
              title,
              message,
              platform: device.platform,
              channel_id,
              image_url,
              category,
              buttons: []
            }
          }, {
            status: () => ({ json: () => {} })
          });

          return {
            device_id: device.device_id,
            platform: device.platform,
            status: 'success',
            result: notificationResult
          };
        } catch (error) {
          return {
            device_id: device.device_id,
            platform: device.platform,
            status: 'failed',
            error: error.message
          };
        }
      })
    );

    res.status(200).json({
      success: true,
      total_devices: devices.length,
      results: results.filter(Boolean)
    });
  } catch (error) {
    console.error("Failed to send notifications:", error);
    res.status(500).json({ error: "Failed to send notifications", details: error.message });
  }
});

/**
 * Send bulk notifications to all devices in a channel
 * @route POST /send-notification-bulk
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} channel_id - ID of the channel
 * @param {string} [image_url] - URL of the notification image
 * @param {string} [category] - Notification category
 * @param {Object} [filter] - Optional filters
 * @param {string} [filter.platform] - Space-separated platforms (e.g., "android ios")
 * @param {string} [filter.session_type] - Session type (user/guest/all)
 * @returns {Object} Notification delivery status and details
 * @throws {400} If required parameters are missing
 * @throws {404} If channel not found
 */
router.post("/send-notification-bulk", async (req, res) => {
  const { 
    title, 
    message, 
    channel_id,
    image_url,
    category,
    buttons,
    filter 
  } = req.body;

  if (!title || !message || !channel_id) {
    return res.status(400).json({ 
      error: "Title, message, and channel_id are required" 
    });
  }

  // Validate buttons format if provided
  if (buttons) {
    if (!Array.isArray(buttons)) {
      return res.status(400).json({ 
        error: "Buttons must be an array" 
      });
    }
    
    for (const button of buttons) {
      if (!button.button_id || !button.button_text || !button.button_url) {
        return res.status(400).json({ 
          error: "Each button must have button_id, button_text, and button_url" 
        });
      }
    }
  }

  try {
    // Build query for device tokens
    const DeviceToken = getModel(DeviceTokenSchema);
    let query = { 
      channel_id,
      status: true 
    };

    // Apply platform filter
    if (filter?.platform) {
      const platforms = filter.platform.split(' ');
      query.platform = { $in: platforms };
    }

    // Apply session type filter
    if (filter?.session_type) {
      if (filter.session_type === 'user') {
        query.user_id = { $exists: true };
      } else if (filter.session_type === 'guest') {
        query.user_id = { $exists: false };
      }
    }

    const devices = await DeviceToken.find(query);
    
    // Track notification before sending
    const notificationId = await trackNotification({
      channel_id,
      title,
      message,
      image_url,
      category,
      buttons,
      sent_to: {
        total: devices.length,
        ios: devices.filter(d => d.platform === 'ios').length,
        android: devices.filter(d => d.platform === 'android').length,
        huawei: devices.filter(d => d.platform === 'huawei').length
      }
    });

    // Send notifications in batches
    const batchSize = 100;
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < devices.length; i += batchSize) {
      const batch = devices.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async device => {
          try {
            const result = await sendNotificationToDevice(
              device.token,
              title,
              message,
              device.platform,
              channel_id,
              image_url,
              category,
              buttons || []
            );
            successCount++;
            return {
              device_id: device.device_id,
              platform: device.platform,
              status: 'success',
              result
            };
          } catch (error) {
            failureCount++;
            return {
              device_id: device.device_id,
              platform: device.platform,
              status: 'failed',
              error: error.message
            };
          }
        })
      );
      results.push(...batchResults);
    }

    // Update notification status
    const NotificationHistory = getModel(NotificationHistorySchema);
    await NotificationHistory.updateOne(
      { notification_id: notificationId },
      { 
        $set: {
          'status.success': successCount,
          'status.failed': failureCount
        }
      }
    );

    res.status(200).json({
      success: true,
      notification_id: notificationId,
      total_devices: devices.length,
      results: results
    });
  } catch (error) {
    console.error("Failed to send bulk notifications:", error);
    res.status(500).json({ error: "Failed to send notifications", details: error.message });
  }
});

/**
 * Create a new channel with platforms
 * @route POST /channel
 * @param {string} company_id - ID of the company
 * @param {string} channel_name - Name of the channel
 * @param {Object} platforms - Platform configurations
 * @param {Object} [platforms.ios] - iOS platform configuration
 * @param {string} platforms.ios.bundle_id - Bundle ID for iOS app
 * @param {string} platforms.ios.key_id - Key ID for iOS platform
 * @param {string} platforms.ios.team_id - Team ID for iOS platform
 * @param {Object} [platforms.android] - Android platform configuration
 * @param {string} platforms.android.bundle_id - Bundle ID for Android app
 * @param {Object} [platforms.huawei] - Huawei platform configuration
 * @param {string} platforms.huawei.bundle_id - Bundle ID for Huawei app
 * @param {File} [ios_file] - iOS p8 certificate file
 * @param {File} [android_file] - Android JSON configuration file
 * @param {File} [huawei_file] - Huawei JSON configuration file
 * @returns {Object} Created channel details
 * @throws {400} If required parameters are missing
 * @throws {500} If channel creation fails
 */
router.post("/channel", upload.fields([
  { name: 'ios_file', maxCount: 1 },
  { name: 'android_file', maxCount: 1 },
  { name: 'huawei_file', maxCount: 1 }
]), async (req, res) => {
  const {
    company_id, // Only used for channel_id generation
    channel_name,
    ios_bundle_id,
    android_bundle_id,
    huawei_bundle_id,
    key_id,
    team_id
  } = req.body;

  if (!company_id || !channel_name) {
    return res.status(400).json({ 
      error: "company_id and channel_name are required" 
    });
  }

  const files = req.files || {};
  const timestamp = Date.now();

  try {
    const Channels = getModel(ChannelsSchema);
    
    const channel_id = `${company_id}_${timestamp}`;
    const channel = new Channels({
      channel_id,  // Use this instead of _id
      channel_name,
      platforms: []
    });

    // Update iOS platform
    if (ios_bundle_id || files.ios_file || key_id || team_id) {
      const iosPlatform = channel.platforms.find(p => p.platform_type === 'ios');
      if (!iosPlatform) {
        // Create new iOS platform if it doesn't exist
        const platform_id = `${channel_id}_ios_${Date.now()}`;
        const iosPath = path.join('configs/uploads', `${platform_id}.p8`);
        
        if (files.ios_file) {
          fs.renameSync(files.ios_file[0].path, iosPath);
        }

        channel.platforms.push({
          platform_id,
          platform_type: 'ios',
          bundle_id: ios_bundle_id,
          key_id: key_id,
          team_id: team_id,
          file_path: iosPath,
          active: true
        });
      } else {
        // Update existing iOS platform
        if (ios_bundle_id) {
          iosPlatform.bundle_id = ios_bundle_id;
        }
        if (key_id) {
          iosPlatform.key_id = key_id;
        }
        if (team_id) {
          iosPlatform.team_id = team_id;
        }
        iosPlatform.active = true;

        if (files.ios_file) {
          if (iosPlatform.file_path && fs.existsSync(iosPlatform.file_path)) {
            fs.unlinkSync(iosPlatform.file_path);
          }
          const iosPath = path.join('configs/uploads', `${iosPlatform.platform_id}.p8`);
          fs.renameSync(files.ios_file[0].path, iosPath);
          iosPlatform.file_path = iosPath;
        }
      }
    }

    // Add Android platform if provided
    if (android_bundle_id || files.android_file) {
      const androidPlatform = channel.platforms.find(p => p.platform_type === 'android');
      if (!androidPlatform) {
        // Create new Android platform if it doesn't exist
        const platform_id = `${channel_id}_android_${Date.now()}`;
        const androidPath = path.join('configs/uploads', `${platform_id}.json`); // Changed to .json for Android
        
        if (files.android_file) {
          fs.renameSync(files.android_file[0].path, androidPath);
        }

        channel.platforms.push({
          platform_id,
          platform_type: 'android',
          bundle_id: android_bundle_id,
          file_path: androidPath,
          active: true
        });
      } else {
        // Update existing Android platform
        if (android_bundle_id) {
          androidPlatform.bundle_id = android_bundle_id;
        }
        androidPlatform.active = true;

        if (files.android_file) {
          if (androidPlatform.file_path && fs.existsSync(androidPlatform.file_path)) {
            fs.unlinkSync(androidPlatform.file_path);
          }
          const androidPath = path.join('configs/uploads', `${androidPlatform.platform_id}.json`); // Changed to .json
          fs.renameSync(files.android_file[0].path, androidPath);
          androidPlatform.file_path = androidPath; // Fixed: Set file_path on platform object
        }
      }
    }

    // Update Huawei platform
    if (huawei_bundle_id || files.huawei_file) {
      const huaweiPlatform = channel.platforms.find(p => p.platform_type === 'huawei');
      if (!huaweiPlatform) {
        // Create new Huawei platform if it doesn't exist
        const platform_id = `${channel_id}_huawei_${Date.now()}`;
        const huaweiPath = path.join('configs/uploads', `${platform_id}.json`);
        
        if (files.huawei_file) {
          fs.renameSync(files.huawei_file[0].path, huaweiPath);
        }

        channel.platforms.push({
          platform_id,
          platform_type: 'huawei',
          bundle_id: huawei_bundle_id,
          file_path: huaweiPath,
          active: true
        });
      } else {
        // Update existing Huawei platform
        if (huawei_bundle_id) {
          huaweiPlatform.bundle_id = huawei_bundle_id;
        }
        huaweiPlatform.active = true;

        if (files.huawei_file) {
          if (huaweiPlatform.file_path && fs.existsSync(huaweiPlatform.file_path)) {
            fs.unlinkSync(huaweiPlatform.file_path);
          }
          const huaweiPath = path.join('configs/uploads', `${huaweiPlatform.platform_id}.json`);
          fs.renameSync(files.huawei_file[0].path, huaweiPath);
          huaweiPlatform.file_path = huaweiPath;
        }
      }
    }

    await channel.save();

    res.status(200).json({
      success: true,
      channel: {
        channel_id: channel.channel_id,  // Use channel_id here
        channel_name: channel.channel_name,
        platforms: channel.platforms
      }
    });
  } catch (error) {
    console.error('Failed to create channel:', error);
    res.status(500).json({ error: "Failed to create channel", details: error.message });
  }
});

/**
 * Update an existing channel
 * @route PUT /channel/:channel_id
 * @param {string} channel_id - ID of the channel to update
 * @param {string} [channel_name] - New name for the channel
 * @param {Object} [platforms] - Updated platform configurations
 * @param {Object} [platforms.ios] - iOS platform configuration
 * @param {string} [platforms.ios.bundle_id] - Bundle ID for iOS app
 * @param {string} [platforms.ios.key_id] - Key ID for iOS platform
 * @param {string} [platforms.ios.team_id] - Team ID for iOS platform
 * @param {Object} [platforms.android] - Android platform configuration
 * @param {string} [platforms.android.bundle_id] - Bundle ID for Android app
 * @param {Object} [platforms.huawei] - Huawei platform configuration
 * @param {string} [platforms.huawei.bundle_id] - Bundle ID for Huawei app
 * @param {File} [ios_file] - New iOS p8 certificate file
 * @param {File} [android_file] - New Android JSON configuration file
 * @param {File} [huawei_file] - New Huawei JSON configuration file
 * @returns {Object} Updated channel details
 * @throws {404} If channel is not found
 * @throws {500} If update fails
 */
router.put("/channel/:channel_id", upload.fields([
  { name: 'ios_file', maxCount: 1 },
  { name: 'android_file', maxCount: 1 },
  { name: 'huawei_file', maxCount: 1 }
]), async (req, res) => {
  const { channel_id } = req.params;
  const { 
    channel_name,
    ios_bundle_id,
    android_bundle_id,
    huawei_bundle_id,
    key_id,
    team_id,
    user_id
  } = req.body;
  const files = req.files || {};

  if (!user_id) {
    return res.status(400).json({ error: "user_id is required" });
  }

  try {
    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });
    
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }
      // Handle platform updates
      // Update iOS platform
      if (ios_bundle_id || files.ios_file || key_id || team_id) {
        const iosPlatform = channel.platforms.find(p => p.platform_type === 'ios');
        
        if (!iosPlatform) {
          // Create new iOS platform if it doesn't exist
          const platform_id = `${channel_id}_ios_${Date.now()}`;
          const iosPath = path.join('configs/uploads', `${platform_id}.p8`);
          
          if (files.ios_file) {
            fs.renameSync(files.ios_file[0].path, iosPath);
          }

          channel.platforms.push({
            platform_id,
            platform_type: 'ios',
            bundle_id: ios_bundle_id,
            key_id: key_id,
            team_id: team_id,
            file_path: iosPath,
            active: true
          });
        } else {
          // Update existing iOS platform
          if (ios_bundle_id) {
            iosPlatform.bundle_id = ios_bundle_id;
          }
          if (key_id) {
            iosPlatform.key_id = key_id;
          }
          if (team_id) {
            iosPlatform.team_id = team_id;
          }
          iosPlatform.active = true;

          if (files.ios_file) {
            if (iosPlatform.file_path && fs.existsSync(iosPlatform.file_path)) {
              fs.unlinkSync(iosPlatform.file_path);
            }
            const iosPath = path.join('configs/uploads', `${iosPlatform.platform_id}.p8`);
            fs.renameSync(files.ios_file[0].path, iosPath);
            iosPlatform.file_path = iosPath;
          }
        }
      }

      // Update Android platform
      if (android_bundle_id || files.android_file) {
        const androidPlatform = channel.platforms.find(p => p.platform_type === 'android');
        if (!androidPlatform) {
          // Create new Android platform if it doesn't exist
          const platform_id = `${channel_id}_android_${Date.now()}`;
          const androidPath = path.join('configs/uploads', `${platform_id}.json`); // Changed to .json for Android
          
          if (files.android_file) {
            fs.renameSync(files.android_file[0].path, androidPath);
          }

          channel.platforms.push({
            platform_id,
            platform_type: 'android',
            bundle_id: android_bundle_id,
            file_path: androidPath,
            active: true
          });
        } else {
          // Update existing Android platform
          if (android_bundle_id) {
            androidPlatform.bundle_id = android_bundle_id;
          }
          androidPlatform.active = true;

          if (files.android_file) {
            if (androidPlatform.file_path && fs.existsSync(androidPlatform.file_path)) {
              fs.unlinkSync(androidPlatform.file_path);
            }
            const androidPath = path.join('configs/uploads', `${androidPlatform.platform_id}.json`); // Changed to .json
            fs.renameSync(files.android_file[0].path, androidPath);
            androidPlatform.file_path = androidPath; // Fixed: Set file_path on platform object
          }
        }
      }

      // Update Huawei platform
      if (huawei_bundle_id || files.huawei_file) {
        const huaweiPlatform = channel.platforms.find(p => p.platform_type === 'huawei');
        if (huaweiPlatform) {
          if (huawei_bundle_id) huaweiPlatform.bundle_id = huawei_bundle_id;
          
          if (files.huawei_file) {
            if (huaweiPlatform.file_path && fs.existsSync(huaweiPlatform.file_path)) {
              fs.unlinkSync(huaweiPlatform.file_path);
            }
            const huaweiPath = path.join('configs/uploads', `${huaweiPlatform.platform_id}.json`);
            fs.renameSync(files.huawei_file[0].path, huaweiPath);
            huaweiPlatform.file_path = huaweiPath;
          }
        }
      }

      // Update channel name if provided
      if (channel_name) {
        channel.channel_name = channel_name;
        channel.markModified('channel_name');
      }

      channel.markModified('platforms');
   

    // Save changes
    await channel.save();

    // Save channel history
    const ChannelHistory = getModel(ChannelHistorySchema);
    await ChannelHistory.create({
      channel_id,
      user_id,
      change_type: 'UPDATE',
      channel_data: channel.toObject()
    });
    
    // Return updated channel
    res.status(200).json({
      success: true,
      channel: {
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        platforms: channel.platforms.filter(p => p.active)
      }
    });

  } catch (error) {
    console.error('Failed to update channel:', error);
    res.status(500).json({ error: "Failed to update channel", details: error.message });
  }
});

/**
 * Get all channels
 * @route GET /channels
 * @returns {Object} All channels and their details
 * @throws {404} If no channels found
 * @throws {500} If retrieval fails
 */
router.get("/channels", async (req, res) => {
  try {
    const Channels = getModel(ChannelsSchema);
    const channels = await Channels.find({});

    if (!channels.length) {
      return res.status(404).json({ error: "No channels found" });
    }

    res.status(200).json({
      success: true,
      total_channels: channels.length,
      channels: channels.map(channel => ({
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        platforms: channel.platforms.filter(p => p.active)
      }))
    });
  } catch (error) {
    console.error("Failed to get channels:", error);
    res.status(500).json({ 
      error: "Failed to get channels",
      details: error.message 
    });
  }
});

/**
 * Get channel details
 * @route GET /channel/:channel_id
 * @param {string} channel_id - ID of the channel to retrieve
 * @returns {Object} Channel details including platforms
 * @throws {404} If channel is not found
 * @throws {500} If retrieval fails
 */
router.get("/channel/:channel_id", async (req, res) => {
  try {
    const { channel_id } = req.params;

    if (!channel_id) {
      return res.status(400).json({ 
        error: "Channel ID is required" 
      });
    }

    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });
    
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    res.status(200).json({
      success: true,
      channel: {
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        platforms: channel.platforms.filter(p => p.active)
      }
    });
  } catch (error) {
    console.error("Failed to get channel details:", error);
    res.status(500).json({ 
      error: "Failed to get channel details",
      details: error.message 
    });
  }
});

/**
 * Get channel history with various time filters
 * @route GET /channel/:channel_id/history
 * @param {string} channel_id - Channel ID
 * @param {string} timeframe - today, week, month, year
 * @returns {Object} Channel history entries
 */
router.get("/channel/:channel_id/history", async (req, res) => {
  const { channel_id } = req.params;
  const { timeframe = 'today' } = req.query;

  try {
    const ChannelHistory = getModel(ChannelHistorySchema);
    
    // Calculate date range based on timeframe
    const now = new Date();
    let startDate;
    
    switch (timeframe) {
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setDate(now.getDate() - 30));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setHours(0, 0, 0, 0));
    }

    const history = await ChannelHistory.find({
      channel_id,
      timestamp: { $gte: startDate }
    }).sort({ timestamp: -1 });

    // Group changes by date
    const groupedHistory = history.reduce((acc, entry) => {
      const date = entry.timestamp.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push({
        user_id: entry.user_id,
        change_type: entry.change_type,
        timestamp: entry.timestamp,
        channel_data: entry.channel_data
      });
      return acc;
    }, {});

    res.status(200).json({
      timeframe,
      total_changes: history.length,
      history: groupedHistory
    });
  } catch (error) {
    console.error("Failed to get channel history:", error);
    res.status(500).json({ error: "Failed to get channel history" });
  }
});

/**
 * Get channel history summary
 * @route GET /channel/:channel_id/history/summary
 * @param {string} channel_id - Channel ID
 * @returns {Object} Summary of changes
 */
router.get("/channel/:channel_id/history/summary", async (req, res) => {
  const { channel_id } = req.params;

  try {
    const ChannelHistory = getModel(ChannelHistorySchema);
    const now = new Date();
    
    // Get counts for different timeframes
    const todayCount = await ChannelHistory.countDocuments({
      channel_id,
      timestamp: { $gte: new Date(now.setHours(0, 0, 0, 0)) }
    });

    const weekCount = await ChannelHistory.countDocuments({
      channel_id,
      timestamp: { $gte: new Date(now.setDate(now.getDate() - 7)) }
    });

    const monthCount = await ChannelHistory.countDocuments({
      channel_id,
      timestamp: { $gte: new Date(now.setDate(now.getDate() - 30)) }
    });

    const yearCount = await ChannelHistory.countDocuments({
      channel_id,
      timestamp: { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) }
    });

    // Get latest change
    const latestChange = await ChannelHistory.findOne({ channel_id })
      .sort({ timestamp: -1 })
      .select('user_id change_type timestamp -_id');

    res.status(200).json({
      changes: {
        today: todayCount,
        last_7_days: weekCount,
        last_30_days: monthCount,
        last_year: yearCount
      },
      latest_change: latestChange
    });
  } catch (error) {
    console.error("Failed to get history summary:", error);
    res.status(500).json({ error: "Failed to get history summary" });
  }
});

// Add this function after other helper functions
async function trackNotification(notificationData) {
  const NotificationHistory = getModel(NotificationHistorySchema);
  const notification = new NotificationHistory({
    notification_id: crypto.randomUUID(),
    ...notificationData
  });
  await notification.save();
  return notification.notification_id;
}

// Add new endpoint for tracking notification opens
router.post("/notification/track", async (req, res) => {
  const { notification_id, platform } = req.body;

  if (!notification_id || !platform) {
    return res.status(400).json({
      error: "Notification ID and platform are required"
    });
  }

  try {
    const NotificationHistory = getModel(NotificationHistorySchema);
    const notification = await NotificationHistory.findOne({ notification_id });

    if (!notification) {
      return res.status(404).json({
        error: "Notification not found"
      });
    }

    // Increment opened count
    notification.opened.total += 1;
    notification.opened[platform.toLowerCase()] += 1;
    
    await notification.save();

    res.status(200).json({
      success: true,
      notification_id,
      opened: notification.opened
    });
  } catch (error) {
    console.error("Failed to track notification:", error);
    res.status(500).json({
      error: "Failed to track notification",
      details: error.message
    });
  }
});

// Add endpoint to get notification statistics
router.get("/notification/:notification_id", async (req, res) => {
  const { notification_id } = req.params;

  try {
    const NotificationHistory = getModel(NotificationHistorySchema);
    const notification = await NotificationHistory.findOne({ notification_id });

    if (!notification) {
      return res.status(404).json({
        error: "Notification not found"
      });
    }

    res.status(200).json({
      success: true,
      notification
    });
  } catch (error) {
    console.error("Failed to get notification stats:", error);
    res.status(500).json({
      error: "Failed to get notification stats",
      details: error.message
    });
  }
});

/**
 * Soft delete a platform by setting active flag to false
 * @route PUT /channel/:channel_id/platform/:platform_id/deactivate
 * @param {string} channel_id - ID of the channel
 * @param {string} platform_id - ID of the platform to deactivate
 * @returns {Object} Updated channel details
 * @throws {404} If channel or platform not found
 * @throws {500} If update fails
 */
router.put("/channel/:channel_id/platform/:platform_id/deactivate", async (req, res) => {
  try {
    const { channel_id, platform_id } = req.params;
    const user_id = req.body.user_id; // For tracking who made the change

    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Find the platform in the channel
    const platformIndex = channel.platforms.findIndex(p => p.platform_id === platform_id);
    if (platformIndex === -1) {
      return res.status(404).json({ error: "Platform not found" });
    }

    // Set the active flag to false
    channel.platforms[platformIndex].active = false;

    // Save the changes
    channel.markModified('platforms');
    await channel.save();

    // Track the change in channel history
    const ChannelHistory = getModel(ChannelHistorySchema);
    await ChannelHistory.create({
      channel_id,
      user_id,
      change_type: 'PLATFORM_DEACTIVATE',
      channel_data: channel.toObject()
    });

    // Return the updated channel
    res.status(200).json({
      success: true,
      channel: {
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        platforms: channel.platforms.filter(p => p.active)
      }
    });

  } catch (error) {
    console.error("Failed to deactivate platform:", error);
    res.status(500).json({ 
      error: "Failed to deactivate platform", 
      details: error.message 
    });
  }
});

/**
 * Get all notifications for a channel with optional filters
 * @route GET /channel/:channel_id/notifications
 * @param {string} channel_id - Channel ID
 * @param {string} [timeframe] - Optional: today, week, month, year
 * @param {string} [platform] - Optional: ios, android, huawei
 * @param {number} [page] - Optional: page number for pagination (default: 1)
 * @param {number} [limit] - Optional: items per page (default: 20)
 * @returns {Object} Paginated notifications with statistics
 */
router.get("/channel/:channel_id/notifications", async (req, res) => {
  try {
    const { channel_id } = req.params;
    const { 
      timeframe = 'all',
      platform,
      page = 1,
      limit = 20
    } = req.query;

    // Validate channel existence
    const Channels = getModel(ChannelsSchema);
    const channel = await Channels.findOne({ channel_id });
    
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // Build query filters
    const query = { channel_id };

    // Add timeframe filter
    const now = new Date();
    switch (timeframe) {
      case 'today':
        query.sent_at = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
        break;
      case 'week':
        query.sent_at = { $gte: new Date(now.setDate(now.getDate() - 7)) };
        break;
      case 'month':
        query.sent_at = { $gte: new Date(now.setDate(now.getDate() - 30)) };
        break;
      case 'year':
        query.sent_at = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
        break;
    }

    // Add platform filter if specified
    if (platform) {
      query[`opened.${platform.toLowerCase()}`] = { $exists: true };
    }

    const NotificationHistory = getModel(NotificationHistorySchema);

    // Get total count for pagination
    const totalCount = await NotificationHistory.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);

    // Get paginated notifications
    const notifications = await NotificationHistory.find(query)
      .sort({ sent_at: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Calculate statistics
    const stats = {
      total_sent: totalCount,
      total_opened: notifications.reduce((sum, n) => sum + n.opened.total, 0),
      platform_stats: {
        ios: notifications.reduce((sum, n) => sum + n.opened.ios, 0),
        android: notifications.reduce((sum, n) => sum + n.opened.android, 0),
        huawei: notifications.reduce((sum, n) => sum + n.opened.huawei, 0)
      },
      success_rate: notifications.reduce((sum, n) => sum + n.status.success, 0),
      failure_rate: notifications.reduce((sum, n) => sum + n.status.failed, 0)
    };

    res.status(200).json({
      success: true,
      channel_id,
      timeframe,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_items: totalCount,
        items_per_page: parseInt(limit)
      },
      statistics: stats,
      notifications: notifications.map(notification => ({
        notification_id: notification.notification_id,
        title: notification.title,
        message: notification.message,
        image_url: notification.image_url,
        sent_at: notification.sent_at,
        opened: notification.opened,
        status: notification.status
      }))
    });

  } catch (error) {
    console.error("Failed to get channel notifications:", error);
    res.status(500).json({ 
      error: "Failed to get channel notifications", 
      details: error.message 
    });
  }
});

router.get(
  "/test-upload",
  async (req, res, next) => {
    const { remotePath } = req.query;
    let json = {};
    if( remotePath ){
      json.localPath = await Dms.certs.get({ remotePath });
    }
    res.json(json);
  }
);

router.post(
  "/test-upload",
  upload.fields([
    { name: 'ios_file', maxCount: 1 },
  ]),
  async (req, res, next) => {
    const files = req.files;
    let saveDetails = await Dms.certs.save({
      file: files.ios_file[0],
      name: `${Date.now()}-${files.ios_file[0].originalname}`
    });
    res.json(saveDetails);
  }
);

// Create a new router for API routes
const apiRouter = express.Router();

// Mount all existing routes under /api
apiRouter.use('/api', router);

module.exports = {
  path: "/pushapp",
  router: apiRouter,
};
