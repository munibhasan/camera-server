const net = require("net");
const cliProgress = require("cli-progress");
const _colors = require("colors");
require("events").EventEmitter.defaultMaxListeners = 0;
require("dotenv").config();
const ftpu = require("./file_transfer_protocol_utils.js");
let { SERVER_PORT } = process.env;

const main = async () => {
  const buffer_size = 20000;

  let serverParser = net.createServer((c) => {
    try {
      const bar1 = new cliProgress.SingleBar(
        {
          format:
            "Download Progress |" +
            _colors.blue("{bar}") +
            "| {percentage}% || {value}/{total} Chunks || ETA: {eta} seconds",
          barsize: 50,
          hideCursor: true
        },
        cliProgress.Presets.shades_grey
      );

      let tcp_buff = Buffer.alloc(0);
      let stateMachine = 0;
      let deviceStatus = new ftpu.DeviceDescriptor();
      console.log(
        "[SERVER] client connected: " + c.remoteAddress + ":" + c.remotePort
      );

      c.on("data", onConnData);
      c.once("close", onConnClose);
      c.on("error", onConnError);
      c.on("timeout", onConnTimeout);

      function onConnData(d) {
        let cmd_size = 0;
        let cmd_id = 0;
        console.log(d.length, "---");
        if (d.length < buffer_size) {
          tcp_buff = Buffer.concat([tcp_buff, d]);
          ftpu.LogString(
            "Data from: " +
              c.remoteAddress +
              "[" +
              tcp_buff.toString("hex") +
              "]"
          );

          while (1) {
            if (tcp_buff.length >= 4) {
              cmd_id = ftpu.ParseCmd(tcp_buff);

              //ftpu.LogString("Received command id " + cmd_id);
              if (ftpu.IsCmdValid(cmd_id)) {
                if (ftpu.CmdHasLengthField(cmd_id)) {
                  cmd_size = tcp_buff.readUInt16BE(2) + 4;
                } else {
                  cmd_size = ftpu.GetExpectedCommandLength(cmd_id);
                }
                ftpu.LogString("CMD size: " + cmd_size);
                if (tcp_buff.length >= cmd_size) {
                  /* Time to parse */
                  ftpu.LogString("Passing CMD with ID " + cmd_id);
                  // console.log("Passing CMD with ID " + cmd_id);
                  stateMachine = ftpu.StateMachine(
                    stateMachine,
                    c,
                    cmd_id,
                    tcp_buff,
                    deviceStatus,
                    bar1
                  );
                  if (tcp_buff.length > cmd_size) {
                    tcp_buff = tcp_buff.slice(cmd_size, tcp_buff.length);
                    ftpu.LogString("Remaining in buffer " + tcp_buff.length);
                  } else {
                    ftpu.LogString("Clearing buffer");
                    tcp_buff = Buffer.alloc(0);
                  }
                } else {
                  break;
                }
              } else {
                // drop the buffer load
                tcp_buff = Buffer.alloc(0);
                break;
              }
            } else {
              break;
            }
          }
        } else {
          // Too much data now
        }
      }

      function onConnClose() {
        console.log("[SERVER] connection from " + c.remoteAddress + " closed");
      }

      function onConnError(err) {
        console.log(
          "[SERVER] connection " + c.remoteAddress + " error: " + err.message
        );
        // Delete file
      }

      function onConnTimeout() {
        console.log(
          "[SERVER] connection from " + c.remoteAddress + " timeouted"
        );
      }
    } catch (e) {
      console.log(e);
    }
  });

  if (SERVER_PORT) {
    serverParser.listen(SERVER_PORT, () => {
      console.log("Camera server running on port ", SERVER_PORT);
    });
  } else {
    console.log("Please set SERVER_PORT in .env file.");
  }
};
try {
  main();
} catch (err) {
  console.log(err);
  main();
}
