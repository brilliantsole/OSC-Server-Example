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

const sendPort = 5000;
const receivePort = 5001;
const localAddress = "0.0.0.0";
const sendAddress = "0.0.0.0";

// OSC
const oscServer = new osc.UDPPort({
  localAddress: localAddress,
  localPort: receivePort,
  metadata: true,
});

oscServer.on("message", function (oscMsg, timeTag, info) {
  console.log("received message", oscMsg);

  const address = oscMsg.address.split("/").filter(Boolean);
  const { args } = oscMsg; // [...{type, value}]

  switch (address[0]) {
    case "setSensorConfiguration":
      /** @type {BS.SensorConfiguration} */
      const sensorConfiguration = {};

      /** @type {BS.SensorType} */
      let sensorType;

      args.forEach((arg) => {
        switch (arg.type) {
          case "s":
            if (BS.SensorTypes.includes(arg.value)) {
              sensorType = arg.value;
            }
            break;
          case "f":
            sensorConfiguration[sensorType] = arg.value;
            break;
        }
      });
      devicePair.setSensorConfiguration(sensorConfiguration);
      break;
    default:
      console.log(`uncaught address ${address[0]}`);
      break;
  }
});

oscServer.open();

const devicePair = BS.DevicePair.shared;

oscServer.on("ready", function () {
  devicePair.addEventListener("deviceSensorData", (event) => {
    let args;
    switch (event.message.sensorType) {
      case "orientation":
        {
          const { pitch, heading, roll } = event.message.orientation;
          args = [pitch, heading, roll].map((value) => {
            return {
              type: "f",
              value,
            };
          });
        }
        break;
      case "pressure":
        args = [
          {
            type: "f",
            value: event.message.pressure.normalizedSum,
          },
        ];
        break;
      default:
        break;
    }

    if (!args) {
      return;
    }

    oscServer.send(
      {
        address: `/${event.message.sensorType}`,
        args: [
          {
            type: "s",
            value: event.message.side,
          },
          ...args,
        ],
      },
      sendAddress,
      sendPort
    );
  });
});
