// ============================================================
//  Netlify Function — titik masuk aplikasi Express
//  Seluruh rute (beranda + dashboard) dihandle oleh server.js
// ============================================================
const serverless = require('serverless-http');
const app = require('../../server');

let ready;

exports.handler = async (event, context) => {
  if (!ready) {
    ready = app
      .boot()
      .then(() => serverless(app))
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready.then((handler) => handler(event, context));
};
