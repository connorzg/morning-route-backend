"use strict"
var Sender = require('node-xcs').Sender;
var Message = require('node-xcs').Message;
var Notification = require('node-xcs').Notification;
var Result = require('node-xcs').Result;
require('newrelic');
require('dotenv').config({silent: true});
var schedule = require('node-schedule');
var fetch = require('node-fetch');
var http = require('http');
var ecstatic = require('ecstatic')(__dirname + '/static');
var router = require('routes')();


// Serve simple static html file when visiting this backend
// Nescessary for server pinging to prevent idle
router.addRoute('/hello/:name', function (req, res, params) {
  res.end('Hello there, ' + params.name + '\n');
});

// HTTP server required for heroku port binding, though XMPP is self-sufficient
var server = http.createServer(function (req, res) {
  var m = router.match(req.url);
  if (m) m.fn(req, res, m.params);
  else ecstatic(req, res)
});
server.listen(process.env.PORT || 5000);

// XMPP server configuration
var xcs = new Sender(process.env.SENDER_ID, process.env.SERVER_KEY);

// Current cron jobs
var jobs = [];

// Pass data when message received from phone
xcs.on('message', function(messageId, from, data, category) {
  console.log('received message', messageId, from, data, category);
  handleQueryInput(from, data);
});

// Notify server when message recived
xcs.on('receipt', function(messageId, from, data, category) {
  console.log('received receipt', arguments);
});

// Format inputs for api query
function handleQueryInput(f, d) {
  let locations = [d.startText, d.endText];
  locations.forEach(function(location) {
    location = location.replace(/\s+/g, '+');
  });
  setSchedule(f, d, locations[0], locations[1]);
}

// Schedule a node-cron job
function setSchedule(f, d, start, end) {
  console.log(`job scheduled at ${d.hour}:${d.minute}`);

  // Cancel then remove previous job for a user/phone
  // Currently only one is job per phone allowed
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].name == f) {
      jobs[i].cancel();
      jobs.splice(i, 1);
    }
  }

  let j = schedule.scheduleJob(f, `${d.minute} ${d.hour} * * 0-5`, function() {
    getRoute(f, start, end);
  });

  // Monitor current number of active users/jobs
  jobs.push(j);
  console.log("Total Jobs:", jobs.length);
}

// WHEN JOB OCCURS:
// Call Google Maps API with user locations and return route overview
function getRoute(f, start, end) {
  let query = `https://maps.googleapis.com/maps/api/directions/json?origin=${start}&destination=${end}&region=us&departure_time=now&traffic_model&key=AIzaSyB3xsLMFn2XoZfmywOnsWn8tf0Ffvw7FF0`
  fetch(query)
    .then((response) => response.json())
    .then((result) => {
      let summary = result.routes[0].summary;
      let driveTime = result.routes[0].legs[0].duration_in_traffic.text;
      console.log(summary, driveTime);
      setNotification(f, summary, driveTime);
  }).catch(function(error) {
    console.log(error);
  });
}

// API callback, create notification for sending
function setNotification(f, summary, driveTime) {
  var notification = new Notification("Morning Route")
      .title(`Take ${summary} today`)
      .body(`Your commute will take ${driveTime}`)
      .build();

  var message = new Message("messageId_1046")
      .priority("high")
      .dryRun(false)
      .deliveryReceiptRequested(true)
      .notification(notification)
      .build();

  sendNotification(f, message, notification)
}

// Sends created notification back to user
function sendNotification(f, message, notification) {
  xcs.sendNoRetry(message, f, function (result) {
      if (result.getError()) {
          console.error(result.getErrorDescription());
      } else {
          console.log("message sent: #" + result.getMessageId());
      }
  });
}
