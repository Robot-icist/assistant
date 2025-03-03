import axios from "axios";
import storage from "node-persist";

// Base URL mapping for different regions
const REGION_BASE_URL = {
  EU: "https://px1.tuyaeu.com",
  US: "https://px1.tuyaus.com",
  CN: "https://openapi.tuya.cn",
};

const REGION_VALUES = { EU: 44, US: 1, CN: 86 };

let userInfo = {
  access_token: "",
  refresh_token: "",
  expires_in: 0,
  devices: [],
  logged_in: false,
  baseUrl: "",
};

export const getUserInfo = () => {
  return userInfo;
};

// Helper function for making requests to the Tuya API
async function makeRequest(url, data, method = "POST", headers = {}) {
  try {
    console.log(userInfo.baseUrl, url, userInfo.baseUrl + url, data, method);
    const response = await axios({
      method: method,
      url: userInfo.baseUrl + url,
      data: data,
      headers: { "Content-Type": "application/json", ...headers },
    });
    console.log(JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error("Error with Tuya API:", error);
    return null;
  }
}

// Login function to authenticate user and retrieve tokens
export async function login(
  username = process.env.SMARTLIFE_USER,
  password = process.env.SMARTLIFE_PWD,
  region = process.env.SMARTLIFE_REGION
) {
  await storage.init();
  userInfo = { ...userInfo, ...(await storage.getItem("userInfo")) };
  console.log(userInfo);
  if (userInfo.access_token != "" && userInfo.expires_in >= Date.now()) return;
  if (!REGION_BASE_URL[region]) {
    console.error("Invalid region");
    return;
  }

  // Set the base URL for the region
  userInfo.baseUrl = REGION_BASE_URL[region];

  const url = "/homeassistant/auth.do";
  const data = {
    userName: username,
    password: password,
    countryCode: REGION_VALUES[region],
    bizType: "smart_life",
    from: "tuya",
  };

  const response = await makeRequest(url, data, "POST", {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (response && response.access_token) {
    userInfo.access_token = response.access_token;
    userInfo.refresh_token = response.refresh_token;
    userInfo.logged_in = true;
    await storeTokens(response);
    console.log("Login successful");
  } else {
    console.log("Login failed");
    userInfo.logged_in = false;
  }
}

// Store tokens for later use
export async function storeTokens(response) {
  // Store tokens securely (e.g., in a file, environment variables, etc.)
  userInfo.access_token = response.access_token;
  userInfo.refresh_token = response.refresh_token;
  userInfo.expires_in = Date.now() + response.expires_in * 1000;
  await storage.setItem("userInfo", userInfo);
}

// Refresh the authentication token
export async function refreshToken() {
  const url = "/homeassistant/access.do";
  const params = {
    grant_type: "refresh_token",
    refresh_token: userInfo.refresh_token,
    rand: Math.random(),
  };

  const response = await makeRequest(url, params, "GET");
  if (response && response.access_token) {
    await storeTokens(response);
  }
}

async function checkToken() {
  if (userInfo.access_token == "" || userInfo.expires_in <= Date.now()) {
    await login();
    await getDeviceList();
  }
}

// Fetch the list of devices
export async function getDeviceList() {
  await checkToken();
  const url = "/homeassistant/skill";
  const data = {
    header: {
      name: "Discovery",
      namespace: "discovery",
      payloadVersion: 1,
    },
    payload: {
      accessToken: userInfo.access_token,
    },
  };

  const response = await makeRequest(url, data);
  if (response && response.payload && response.payload.devices) {
    userInfo.devices = response.payload.devices;
    await storage.setItem("userInfo", userInfo);
    return userInfo.devices;
  }
  return [];
}

// Adjust a device (e.g., turn on/off, adjust brightness)
export async function adjustDevice(device, action, valueName, newState) {
  await checkToken();
  const url = "/homeassistant/skill";
  const data = {
    header: {
      name: action,
      namespace: "control",
      payloadVersion: 1,
    },
    payload: {
      accessToken: userInfo.access_token,
      devId: device?.id,
      [valueName]: newState,
    },
  };

  const response = await makeRequest(url, data);
  return response;
}

// Example function to toggle the state of a device
export async function toggleDevice(device) {
  const currentState = device?.data?.state;
  const newState = currentState === false ? 1 : 0;
  const result = await adjustDevice(device, "turnOnOff", "value", newState);
  if (result && result.header && result.header.code === "SUCCESS") {
    device.data.state = !currentState;
    console.log(`Device ${device.name} state toggled.`);
  }
}

export async function turnDevice(device, onOrOff) {
  const result = await adjustDevice(
    device,
    "turnOnOff",
    "value",
    onOrOff ? 1 : 0
  );
  if (result && result.header && result.header.code === "SUCCESS") {
    device.data.state = !currentState;
    console.log(`Device ${device.name} state ${onOrOff ? "ON" : "OFF"}.`);
  }
}

// Example function to change brightness of a device
export async function changeBrightness(device, newBrightness) {
  const result = await adjustDevice(
    device,
    "brightnessSet",
    "value",
    newBrightness
  );
  if (result && result.header && result.header.code === "SUCCESS") {
    device.data.brightness = newBrightness;
    console.log(`Device ${device.name} brightness set to ${newBrightness}.`);
  }
}

// Example function to change the color temperature of a device
export async function changeColorTemperature(device, newTemperature) {
  const result = await adjustDevice(
    device,
    "colorTemperatureSet",
    "value",
    newTemperature
  );
  if (result && result.header && result.header.code === "SUCCESS") {
    device.data.color_temp = newTemperature;
    console.log(
      `Device ${device.name} color temperature set to ${newTemperature}.`
    );
  }
}

export default {
  login,
  getUserInfo,
  refreshToken,
  getDeviceList,
  adjustDevice,
  turnDevice,
  toggleDevice,
  changeBrightness,
  changeColorTemperature,
};
