import { app, BrowserWindow } from "electron";
import WebSocket, { WebSocketServer } from "ws";

const createWindow = () => {
  const win = new BrowserWindow({
    // width: 400,
    // height: 300,
    // x: 1100,
    // y: 500,
    // frame: false,
  });

  try {
    win.loadURL("http://localhost:1234");
    // win.loadFile("./bubble.html");
  } catch (error) {
    win.close();
    createWindow();
  }
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver", 1);
  // win.hide();

  const ws = new WebSocket(`ws://localhost:80`);

  ws.on("error", console.error);

  ws.on("open", function open() {
    console.log("ws connected");
    // ws.send(Date.now());
    ws.send("Electron Visual Connected");
  });

  ws.on("close", function close() {
    console.log("ws disconnected");
  });

  ws.on("message", function message(data) {
    // console.log("ws message", data);
    // Gérer le message reçu
    if (data.includes("hide")) {
      win.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: false });
      win.setAlwaysOnTop(false);
      win.hide();
    } else if (data.includes("show")) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      win.setAlwaysOnTop(true, "screen-saver", 1);
      win.show();
    }
  });
};

app.whenReady().then(() => {
  createWindow();
});
