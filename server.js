import express from "express";
import https from "https";
import http from "http";
const app = express();
import fs from "fs";
import ip from "ip";
import { WebSocketServer } from "ws";
import * as BS from "brilliantsole/node";
import osc from "osc";
import * as THREE from "three";

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
          case "i":
            sensorConfiguration[sensorType] = arg.value;
            break;
        }
      });
      devicePair.setSensorConfiguration(sensorConfiguration);
      break;
    case "resetGameRotation":
      inverseGameRotation.left.copy(latestGameRotation.left).invert();
      inverseGameRotation.right.copy(latestGameRotation.right).invert();
      break;
    default:
      console.log(`uncaught address ${address[0]}`);
      break;
  }
});

oscServer.open();

const devicePair = BS.DevicePair.shared;

const quaternions = {
  left: new THREE.Quaternion(),
  right: new THREE.Quaternion(),
};
const eulers = {
  left: new THREE.Euler(0, 0, 0, "YXZ"),
  right: new THREE.Euler(0, 0, 0, "YXZ"),
};
const inverseGameRotation = {
  left: new THREE.Quaternion(),
  right: new THREE.Quaternion(),
};
const gameRotation = {
  left: new THREE.Quaternion(),
  right: new THREE.Quaternion(),
};
const latestGameRotation = {
  left: new THREE.Quaternion(),
  right: new THREE.Quaternion(),
};
const linearAcceleration = {
  left: new THREE.Vector3(),
  right: new THREE.Vector3(),
};

let sendQuaternionAsEuler = false;
let includePressureSensors = true;

oscServer.on("ready", function () {
  devicePair.addEventListener("deviceSensorData", (event) => {
    const { side, sensorType } = event.message;
    let args;
    switch (sensorType) {
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
      case "gameRotation":
        const quaternion = gameRotation[side];
        quaternion.copy(event.message.gameRotation);
        quaternion.premultiply(inverseGameRotation[side]);

        if (sendQuaternionAsEuler) {
          const euler = eulers[side];
          euler.setFromQuaternion(quaternion);
          const [pitch, yaw, roll, order] = euler.toArray();
          args = [pitch, yaw, roll].map((value) => {
            return {
              type: "f",
              value: THREE.MathUtils.radToDeg(value),
            };
          });
        } else {
          const { x, y, z, w } = quaternion;
          args = [x, y, z, w].map((value) => {
            return {
              type: "f",
              value,
            };
          });
        }

        latestGameRotation[side].copy(event.message.gameRotation);
        break;
      case "linearAcceleration":
        {
          const vector = linearAcceleration[side];
          vector.copy(event.message.linearAcceleration);
          vector.applyQuaternion(gameRotation[side]);
          const [x, y, z] = vector.toArray();
          args = [x, y, z].map((value) => {
            return {
              type: "f",
              value,
            };
          });
        }
        break;
      case "gyroscope":
        {
          const { x, y, z } = event.message.gyroscope;
          args = [x, y, z].map((value) => {
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
          {
            type: "f",
            value: event.message.pressure.normalizedSum > 0.01 ? event.message.pressure.normalizedCenter?.y || 0 : 0,
          },
        ];
        if (includePressureSensors) {
          event.message.pressure.sensors.forEach((sensor) => {
            args.push({
              type: "f",
              value: sensor.normalizedValue,
            });
          });
        }
        break;
      default:
        break;
    }

    if (!args) {
      return;
    }

    oscServer.send(
      {
        address: `/${sensorType}`,
        args: [
          {
            type: "s",
            value: side,
          },
          ...args,
        ],
      },
      sendAddress,
      sendPort
    );
  });
});
