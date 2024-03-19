const fs = require("fs");
const winston = require("winston");
const { exec } = require("child_process");
const AWS = require("aws-sdk");
const { ObjectId } = require("mongodb");
require("dotenv").config();

let { accessKeyId, secretAccessKey, region } = process.env;

const s3 = new AWS.S3({
  accessKeyId,
  secretAccessKey,
  region
});
var amqp = require("amqplib/callback_api");
var MongoClient = require("mongodb").MongoClient;
const url =
  "mongodb+srv://Wrapper:D2zQcgJvtnKS4Jkr@vtracksolutions.nih4b.mongodb.net/VtrackV1?retryWrites=true&w=majority";
/* Constants */
const ReceiveState = {
  INIT: 0,
  WAITFORSTART: 1,
  WAITFORSYNC: 2,
  RECEIVEDATA: 3
};

const file_path = {
  PHOTO_FRONT: "%photof",
  PHOTO_REAR: "%photor",
  VIDEO_FRONT: "%videof",
  VIDEO_REAR: "%videor"
};

const download_opt = {
  PHOTO_FRONT: {
    req: "%photof",
    file_end: "image.jpeg"
  },
  PHOTO_REAR: {
    req: "%photor",
    file_end: "image.jpeg"
  },
  VIDEO_FRONT: {
    req: "%videof",
    file_end: "video.h265"
  },
  VIDEO_REAR: {
    req: "%videor",
    file_end: "video.h265"
  }
};

/* Create logger */
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "user-service" },
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" })
  ]
});

let deviceDirectory;
let filename;
let actual_crc = 0;
let received_packages = 0;
let total_packages = 0;
let extension_to_use = "";
let query_file = 0;

file_buff = Buffer.alloc(0);

/* Rewrite in ES6 */
function Device() {
  this.deviceDirectory = "";
  this.filename = "";
  this.actual_crc = 0;
  this.received_packages = 0;
  this.total_packages = 0;
  this.extension_to_use = "";
  this.query_file = 0;
  this.file_buff = Buffer.alloc(0);
}

exports.DeviceDescriptor = Device;
Device.prototype.setDeviceDirectory = function (directory) {
  this.deviceDirectory = directory;
};

Device.prototype.getDeviceDirectory = function () {
  return this.deviceDirectory;
};

Device.prototype.setCurrentFilename = function (filename) {
  this.filename = filename;
};

Device.prototype.getCurrentFilename = function () {
  return this.filename;
};

Device.prototype.setLastCRC = function (crc) {
  this.actual_crc = crc;
};

Device.prototype.getLastCRC = function () {
  return this.actual_crc;
};

Device.prototype.incrementReceivedPackageCnt = function () {
  this.received_packages++;
};

Device.prototype.getReceivedPackageCnt = function () {
  return this.received_packages;
};

Device.prototype.resetReceivedPackageCnt = function () {
  this.received_packages = 0;
};

Device.prototype.setTotalPackages = function (pkg) {
  this.total_packages = pkg;
};

Device.prototype.getTotalPackages = function () {
  return this.total_packages;
};

Device.prototype.getExtension = function () {
  return this.extension_to_use;
};

Device.prototype.setExtension = function (extension) {
  this.extension_to_use = extension;
};

Device.prototype.setFileToDL = function (file) {
  this.query_file = file;
};

Device.prototype.getFileToDL = function (file) {
  return this.query_file;
};

Device.prototype.getFileBuffer = function () {
  return this.file_buff;
};

Device.prototype.addToBuffer = function (data) {
  this.file_buff = Buffer.concat([this.file_buff, data]);
};

Device.prototype.clearBuffer = function () {
  this.file_buff = Buffer.alloc(0);
};

function crc16_generic(init_value, poly, data) {
  let RetVal = init_value;
  let offset;

  for (offset = 0; offset < data.length; offset++) {
    let bit;
    RetVal ^= data[offset];
    for (bit = 0; bit < 8; bit++) {
      let carry = RetVal & 0x01;
      RetVal >>= 0x01;
      if (carry) {
        RetVal ^= poly;
      }
    }
  }
  return RetVal;
}

exports.ParseCmd = function (a) {
  return a.readUInt16BE(0);
};

exports.CmdHasLengthField = function getCmdLengthOpt(cmd_id) {
  if (cmd_id == 4 || cmd_id == 5) {
    return true;
  }
  return false;
};

exports.IsCmdValid = function doesCmdExist(cmd_id) {
  if (cmd_id < 10) {
    return true;
  } else {
    return false;
  }
};

exports.GetExpectedCommandLength = function (cmd) {
  let return_value = 0;
  switch (cmd) {
    case 0:
      return_value = 16;
      break;
    case 1:
      return_value = 10;
      break;
    case 3:
      return_value = 8;
      break;
  }
  return return_value;
};

function LogStringLocal(string) {
  console.log(string, "=");
  logger.log("info", string);
  return 0;
}
exports.LogString = LogStringLocal;

function ConvertVideoFile(directory, filename, extension) {
  let form_command =
    'ffmpeg -r 25 -i "' +
    directory +
    "\\" +
    filename +
    extension +
    '" -ss 00:00:0.9 -c:a copy -c:v libx264 "' +
    directory +
    "\\" +
    filename +
    '.mp4"';
  exec(form_command, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
      return;
    }
  });
}

// function UpdatePathWithFileUploads (imei,path){

//     MongoClient.connect(url, function(err, db) {
//         if (err) throw err;
//         var dbo = db.db("VtrackV1");
//         var myquery = { IMEI: imei.toString(),requestStatus:"3" };

//         //{$set: {"name": req.body.name}}
//         var newvalues = { $set: {"path": path } };
//         dbo.collection("requestvideos").updateOne(myquery, newvalues, function(err, res) {
//           if (err) throw err;
//           console.log("1 document updated with IMEI "+imei);
//           db.close();
//         });
//       });

// }

function UpdateProcessStatus(imei, percent) {
  MongoClient.connect(url, function (err, db) {
    if (err) throw err;
    var dbo = db.db("VtrackV1");
    var myquery = {
      IMEI: imei.toString(),
      latestVideo: true,
      requestStatus: { $in: ["1", "2", "3", "4"] }
    };

    //{$set: {"name": req.body.name}}
    var newvalues = { $set: { CompletePercentage: `${percent}` } };
    dbo
      .collection("requestvideos")
      .updateOne(myquery, newvalues, function (err, res) {
        if (err) throw err;
        console.log("1 document updated with IMEI " + imei);
        db.close();
      });
  });
}

function UpdateRequestStatus(imei) {
  MongoClient.connect(url, function (err, db) {
    if (err) throw err;
    var dbo = db.db("VtrackV1");
    var myquery = {
      IMEI: imei.toString(),
      latestVideo: true,
      requestStatus: { $in: ["1", "2", "3", "4"] }
    };

    //{$set: {"name": req.body.name}}
    var newvalues = { $set: { requestStatus: "4" } };
    dbo
      .collection("requestvideos")
      .updateOne(myquery, newvalues, function (err, res) {
        if (err) throw err;
        console.log("1 document updated with IMEI " + imei);
        db.close();
      });
  });
}

exports.StateMachine = function (
  current_state,
  conn,
  cmd,
  d,
  device_status,
  bar1
) {
  let stateMachine = current_state;
  let finish_comms = false;
  let imei;
  let value = 0;
  // let command_count=1;
  switch (current_state) {
    case ReceiveState.INIT:
      imei = d.readBigUInt64BE(4);
      device_status.setDeviceDirectory(imei.toString());
      UpdateRequestStatus(imei);
      //deviceDirectory = imei.toString();
      if (!fs.existsSync(device_status.getDeviceDirectory())) {
        LogStringLocal(
          "Creating directory " + device_status.getDeviceDirectory()
        );
        console.log(
          "[INFO] Creating directory " + device_status.getDeviceDirectory()
        );
        fs.mkdirSync(device_status.getDeviceDirectory());
      }

      const opt1_byte = d.readUInt8(12);

      if (opt1_byte & 0x20) {
        LogStringLocal("Video file rear available!");
        console.log("[INFO] Video file rear available!");
        device_status.setFileToDL(file_path.VIDEO_REAR);
        device_status.setExtension(".h265");
        //extension_to_use = ".h265";
      } else if (opt1_byte & 0x10) {
        LogStringLocal("Video file front available!");
        console.log("[INFO] Video file front available!");
        device_status.setFileToDL(file_path.VIDEO_FRONT);
        device_status.setExtension(".h265");
      } else if (opt1_byte & 0x08) {
        LogStringLocal("Photo rear available!");
        console.log("[INFO] Photo rear available!");
        device_status.setFileToDL(file_path.PHOTO_REAR);
        device_status.setExtension(".jpeg");
      } else if (opt1_byte & 0x04) {
        LogStringLocal("Photo front available!");
        console.log("[INFO] Photo front available!");
        device_status.setFileToDL(file_path.PHOTO_FRONT);
        device_status.setExtension(".jpeg");
      } else {
        device_status.setFileToDL(0);
        console.log(opt1_byte);
        LogStringLocal("No files available!");
        console.log("[INFO] No files available!");
        finish_comms = true;
      }

      if (device_status.getFileToDL() != 0) {
        device_status.clearBuffer();
        //actual_crc = 0;
        device_status.setLastCRC(0);
        const query = Buffer.from([
          0, 8, 0, 7, 37, 112, 104, 111, 116, 111, 102
        ]);
        query.write(device_status.getFileToDL(), 4);
        LogStringLocal("[SERVER.SOCKET.TX]: " + query.toString("hex"));
        conn.write(query);
        stateMachine = ReceiveState.WAITFORSTART;
      }
      break;
    case ReceiveState.WAITFORSTART:
      LogStringLocal("[INFO] @SYNC stage");
      filename = new Date()
        .toISOString()
        .replace(/T/, " ")
        .replace(/\..+/, "")
        .replace(/:/g, "")
        .replace(/ /g, "");
      device_status.setCurrentFilename(filename);
      LogStringLocal("Filename to use: " + device_status.getCurrentFilename());
      console.log(
        "[INFO] Filename to use: " + device_status.getCurrentFilename()
      );
      device_status.setTotalPackages(d.readUInt32BE(4));
      LogStringLocal(
        "Total packages incoming for this file: " + total_packages
      );
      if (device_status.getTotalPackages() == 0) {
        finish_comms = true;
      } else if (cmd == 1) {
        // send Resume command
        LogStringLocal("[INFO] Sending resume command");
        const query = Buffer.from([0, 2, 0, 4, 0, 0, 0, 1]);
        conn.write(query);
        LogStringLocal("[SERVER.SOCKET.TX]: " + query.toString("hex"));
        stateMachine = ReceiveState.WAITFORSYNC;
        let total_pkg = device_status.getTotalPackages();
        bar1.start(total_pkg, 0);
      }
      break;
    case ReceiveState.WAITFORSYNC:
      LogStringLocal("[INFO] Wait for SYNC cmd...");
      if (cmd == 3) {
        LogStringLocal("[INFO] Sync has been received!");
        stateMachine = ReceiveState.RECEIVEDATA;
      }
      break;
    case ReceiveState.RECEIVEDATA:
      if (cmd == 4) {
        /* Read data length minus CRC */
        let data_len = d.readUInt16BE(2) - 2;
        /* Get raw file data */
        let raw_file = d.slice(4, 4 + data_len);
        /* Calculate CRC + add sum of last packet */
        let computed_crc = crc16_generic(
          device_status.getLastCRC(),
          0x8408,
          d.slice(4, 4 + data_len)
        );
        /* Read actual CRC in packet */
        actual_crc = d.readUInt16BE(4 + data_len);
        /* Calculate CRC and display with actual */
        LogStringLocal(
          "CRC = Computed: " + computed_crc + ", Actual : " + actual_crc
        );
        device_status.incrementReceivedPackageCnt();
        LogStringLocal(
          "Package: " +
            device_status.getReceivedPackageCnt() +
            " / " +
            device_status.getTotalPackages()
        );
        device_status.addToBuffer(raw_file);
        let rx_pkg_cnt = device_status.getReceivedPackageCnt();
        var percent =
          (device_status.getReceivedPackageCnt() /
            device_status.getTotalPackages()) *
          100;
        bar1.update(rx_pkg_cnt);
        if (percent > 20 && percent < 30) {
          UpdateProcessStatus(device_status.getDeviceDirectory(), percent);
        }

        if (percent > 20 && percent < 40) {
          UpdateProcessStatus(device_status.getDeviceDirectory(), percent);
        }
        if (percent > 41 && percent < 60) {
          UpdateProcessStatus(device_status.getDeviceDirectory(), percent);
        }
        if (percent > 61 && percent < 80) {
          UpdateProcessStatus(device_status.getDeviceDirectory(), percent);
        }

        if (percent > 81 && percent < 100) {
          UpdateProcessStatus(device_status.getDeviceDirectory(), percent);
        }

        if (computed_crc != actual_crc) {
          LogStringLocal("CRC mismatch!");
          device_status.setLastCRC(0);
          //TODO: finish this
          //const query = Buffer.from([0, 2, 0, 4, 0, 0, 0, 1]);
          ////writeUInt32BE
          //conn.write(query);
          //stateMachine = ReceiveState.WAITFORSYNC;
        } else {
          device_status.setLastCRC(actual_crc);
        }

        if (
          device_status.getTotalPackages() ==
          device_status.getReceivedPackageCnt()
        ) {
          bar1.stop();
          temp_file_buff = Buffer.alloc(0);
          temp_file_buff = Buffer.concat([
            temp_file_buff,
            device_status.getFileBuffer()
          ]);
          var fileName;
          var dateValue = new Date();
          var fileType = 1;
          if (device_status.getExtension() == ".h265") {
            fileName = device_status.getCurrentFilename() + ".mp4";
            fileType = 2;
          } else {
            fileName =
              device_status.getCurrentFilename() + device_status.getExtension();
            fileType = 1;
          }

          if (device_status.getExtension() == ".mp4") {
          }
          var uploadedPath;
          const params = {
            Bucket: "vtracksolutions/media", // pass your bucket name
            Key:
              device_status.getDeviceDirectory() +
              "/" +
              dateValue.valueOf() +
              device_status.getCurrentFilename() +
              device_status.getExtension(),
            Body: temp_file_buff
          };
          s3.upload(params, function (s3Err, temp_file_buff) {
            if (s3Err) return LogStringLocal(s3Err);
            uploadedPath = temp_file_buff.Location;
            console.log(
              `File uploaded successfully at ${temp_file_buff.Location}`
            );

            MongoClient.connect(url, function (err, db) {
              if (err) throw err;
              var dbo = db.db("VtrackV1");
              dbo
                .collection("devices")
                .findOne(
                  { deviceIMEI: device_status.getDeviceDirectory() },
                  function (err, fetchedDevice) {
                    if (fetchedDevice != null && fetchedDevice != undefined) {
                      dbo
                        .collection("deviceassigns")
                        .findOne(
                          { DeviceId: fetchedDevice._id.toString() },
                          function (err, fetchedDeviceassign) {
                            if (
                              fetchedDeviceassign != null &&
                              fetchedDeviceassign != undefined
                            ) {
                              dbo.collection("vehicles").findOne(
                                {
                                  _id: ObjectId(fetchedDeviceassign.VehicleId)
                                },
                                function (err, fetchedVehicle) {
                                  if (
                                    fetchedVehicle != null &&
                                    fetchedVehicle != undefined
                                  ) {
                                    var videoListObject = {};
                                    videoListObject["clientId"] =
                                      fetchedDeviceassign.clientId;
                                    videoListObject["dateTime"] = dateValue;

                                    videoListObject["fileType"] = fileType;
                                    videoListObject["fileName"] = fileName;
                                    videoListObject["Vehicle"] =
                                      fetchedVehicle.vehicleReg;
                                    videoListObject["path"] =
                                      uploadedPath.replace(".h265", ".mp4");
                                    videoListObject["isSeen"] = false;

                                    dbo
                                      .collection("videolists")
                                      .insertOne(
                                        videoListObject,
                                        function (err, res) {
                                          if (err) throw err;
                                          console.log("1 document inserted");
                                          // db.close();
                                        }
                                      );

                                    var myquery = {
                                      IMEI: device_status.getDeviceDirectory(),
                                      latestVideo: true,
                                      requestStatus: "4"
                                    };

                                    var newvalues = {};
                                    if (
                                      uploadedPath
                                        .toString()
                                        .substr(
                                          uploadedPath.toString().length - 3,
                                          3
                                        ) == "peg"
                                    ) {
                                      var newvalues = {
                                        $set: {
                                          requestStatus: "5",
                                          path: `${uploadedPath}`,
                                          isReceived: true,
                                          reciveDateTime: `${new Date()}`
                                        }
                                      };
                                    } else {
                                      var newvalues = {
                                        $set: {
                                          requestStatus: "5",
                                          path: `${uploadedPath.replace(
                                            ".h265",
                                            ".mp4"
                                          )}`,
                                          reciveDateTime: `${new Date()}`
                                        }
                                      };
                                    }
                                    let options = { returnDocument: "after" };
                                    // dbo.collection("requestvideos").updateOne(myquery, newvalues, function(err, res) {
                                    //   if (err) throw err;
                                    //   console.log("1 document updated with IMEI "+imei);

                                    // });

                                    dbo
                                      .collection("requestvideos")
                                      .findOneAndUpdate(
                                        myquery,
                                        newvalues,
                                        { returnDocument: "after" },
                                        (err, upadatedDoc) => {
                                          if (err) {
                                            console.log(
                                              "Something wrong when updating data!"
                                            );
                                          }
                                          console.log(upadatedDoc);
                                          if (
                                            upadatedDoc.value != null &&
                                            upadatedDoc.value != undefined
                                          ) {
                                            if (
                                              upadatedDoc.value.file_type == 1
                                            ) {
                                              amqp.connect(
                                                "amqps://vtracksolutionsdotcodotuk:!3Vtr@q$01u55@@b-aa9060e2-4d05-4060-afb5-6b6a2224fffc.mq.eu-west-2.amazonaws.com:5671",
                                                function (err, conn) {
                                                  if (err) throw err;

                                                  conn.createChannel(
                                                    (err, ch1) => {
                                                      if (err) throw err;
                                                      var queue =
                                                        "VtrackNotificationChannel";

                                                      var viewModel = {};
                                                      viewModel[
                                                        "requestedUser"
                                                      ] =
                                                        upadatedDoc.value.requestedUser;
                                                      viewModel["Vehicle"] =
                                                        upadatedDoc.value.vehicle;
                                                      viewModel["Msg"] =
                                                        "Requested Processed";
                                                      var stringViewModel =
                                                        JSON.stringify(
                                                          viewModel
                                                        );
                                                      ch1.sendToQueue(
                                                        queue,
                                                        Buffer.from(
                                                          stringViewModel
                                                        )
                                                      );
                                                    }
                                                  );
                                                }
                                              );
                                            }
                                          }
                                        }
                                      );
                                  }
                                }
                              );
                            }
                          }
                        );
                    }
                  }
                );
            });

            temp_file_buff = Buffer.alloc(0);
          });

          // fs.appendFile("./" + device_status.getDeviceDirectory() + '/' + device_status.getCurrentFilename() + device_status.getExtension(), temp_file_buff, function (err) {
          //     temp_file_buff = Buffer.alloc(0);
          //     if (err) return LogStringLocal(err);
          //     LogStringLocal("Data written to file " + device_status.getCurrentFilename() + " successfully");
          //     console.log("[INFO] Data written to file " + device_status.getCurrentFilename() + " successfully");
          // });
          console.log("[INFO] Looking for more files...");
          const query = Buffer.from([0, 9]);
          conn.write(query);
          stateMachine = ReceiveState.INIT;
          // if (device_status.getFileToDL() == file_path.VIDEO_REAR || device_status.getFileToDL() == file_path.VIDEO_FRONT) {
          //     ConvertVideoFile(device_status.getDeviceDirectory(), device_status.getCurrentFilename(), device_status.getExtension());
          // }
          device_status.resetReceivedPackageCnt();
          device_status.clearBuffer();
        }
      }
      break;
  }

  /* Send close session command */
  if (finish_comms) {
    console.log("[INFO] Closing session");
    const query = Buffer.from([0, 0, 0, 0]); // Close session
    conn.write(query);
    stateMachine = ReceiveState.INIT;
    device_status.setTotalPackages(0);
    device_status.resetReceivedPackageCnt();
    device_status.setLastCRC(0);
  }

  return stateMachine;
};
