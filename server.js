import express from "express";
import https from "https";
import http from "http";
const app = express();
import fs from "fs";
import ip from "ip";
import { WebSocketServer } from "ws";
import * as BS from "brilliantsole";
import osc from "osc";

// HTTPS SERVER
app.use(function (req, res, next) {
  res.header("Cross-Origin-Opener-Policy", "same-origin");
  res.header("x-frame-options", "same-origin");

  next();
});
app.use(express.static("./"));

const serverOptions = {
  key: fs.readFileSync("./sec/key.pem"),
  cert: fs.readFileSync("./sec/cert.pem"),
};

const httpServer = http.createServer(app);
httpServer.listen(80);
const httpsServer = https.createServer(serverOptions, app);
httpsServer.listen(443, () => {
  console.log(`server listening on https://${ip.address()}`);
});

// WEBSOCKET
const wss = new WebSocketServer({ server: httpsServer });
const webSocketServer = new BS.WebSocketServer();
webSocketServer.clearSensorConfigurationsWhenNoClients = false;
webSocketServer.server = wss;

// OSC
const oscServer = new osc.UDPPort({
  localAddress: "0.0.0.0",
  localPort: 57121,
  metadata: true,
});

oscServer.on("message", function (oscMsg, timeTag, info) {
  console.log("An OSC message just arrived!", oscMsg);
  console.log("Remote info is: ", info);
});

oscServer.open();

const devicePair = BS.DevicePair.shared;

oscServer.on("ready", function () {
  devicePair.addEventListener("deviceOrientation", (event) => {
    oscServer.send(
      {
        address: "/orientation",
        args: [
          {
            type: "s",
            value: "left",
          },
          {
            type: "f",
            value: event.message.orientation.heading,
          },
        ],
      },
      "127.0.0.1",
      8000
    );
  });

  oscServer.send(
    {
      address: "/s_new",
      args: [
        {
          type: "s",
          value: "default",
        },
        {
          type: "i",
          value: 100,
        },
      ],
    },
    "127.0.0.1",
    8000
  );
});
