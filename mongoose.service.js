const mongoose = require("mongoose");

let count = 0;
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true
};

const connectWithRetry = () => {
  const uri =
    "mongodb+srv://Wrapper:D2zQcgJvtnKS4Jkr@vtracksolutions.nih4b.mongodb.net/VtrackV1?retryWrites=true&w=majority";
  mongoose
    .connect(uri, options)
    .then(() => {
      console.log("MongoDB is connected");
    })
    .catch((err) => {
      console.log(
        "MongoDB connection unsuccessful, retry after 5 seconds. ",
        err
      );
      setTimeout(connectWithRetry, 5000);
    });
};

// Development DevWrapp Database Connection
const connectWithRetryDev = () => {
  // const uri = "mongodb://127.0.0.1:27017/VtrackV1_Local?retryWrites=true&w=majority";
  const uri =
    "mongodb+srv://DevWrapper:nuLxZCq6XRiKL8p3@vtracksolutions.nih4b.mongodb.net/Dev_VtrackV1?retryWrites=true&w=majority";
  mongoose
    .connect(uri, options)
    .then(() => {
      console.log("DevWrapper for devlopemnt MongoDB is connected");
    })
    .catch((err) => {
      console.log(
        "DevWrapper MongoDB connection unsuccessful, retry after 5 seconds. ",
        err
      );
      setTimeout(connectWithRetry, 5000);
    });
};

if (process.env.ENVIRONMENT === "DEVELOPMENT") {
  connectWithRetryDev();
} else {
  connectWithRetry();
}

exports.mongoose = mongoose;
