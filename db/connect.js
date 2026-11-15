import mongoose from "mongoose";
export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri)
    throw new Error(
      "MONGODB_URI is missing. Copy .env.example to .env and configure MongoDB."
    );
  mongoose.set("bufferCommands", false);
  // Filters are constructed on the server. Never pass request bodies directly to Mongoose.
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  mongoose.connection.on("error", () =>
    console.error(
      JSON.stringify({ level: "error", event: "database_connection_error" })
    )
  );
  return mongoose.connection;
}
