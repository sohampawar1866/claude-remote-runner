import { Client } from 'appwrite';
import WebSocket from 'ws';
global.window = global;
global.WebSocket = WebSocket;
const client = new Client().setEndpoint('https://cloud.appwrite.io/v1').setProject('test');
try {
  client.subscribe('test', () => {});
  console.log("Success!");
} catch (e) {
  console.log(e.message);
}
