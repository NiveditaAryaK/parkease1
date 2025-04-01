import redis from "./redis";
import Redlock from "redlock";

const redlock = new Redlock([redis], {
  retryCount: 3,
  retryDelay: 200,
});

export default redlock;
