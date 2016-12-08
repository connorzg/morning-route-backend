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
router.addRoute('/hello/:name', function (req, res, params) {
  res.end('Hello there, ' + params.name + '\n');
});
var server = http.createServer(function (req, res) {
  var m = router.match(req.url);
  if (m) m.fn(req, res, m.params);
  else ecstatic(req, res)
});
server.listen(8000);

var xcs = new Sender(process.env.SENDER_ID, process.env.SERVER_KEY);

var jobs = [];

xcs.on('message', function(messageId, from, data, category) {
  console.log('received message', messageId, from, data, category);
  handleQueryInput(from, data);
});

xcs.on('receipt', function(messageId, from, data, category) {
  console.log('received receipt', arguments);
});

function handleQueryInput(f, d) {
  let locations = [d.startText, d.endText];
  locations.forEach(function(location) {
    location = location.replace(/\s+/g, '+');
  });
  console.log(`query input handled`);
  setSchedule(f, d, locations[0], locations[1]);
}

function setSchedule(f, d, start, end) {
  console.log(`job scheduled at ${d.hour}:${d.minute} for ${f}`);

  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i].name == f) {
      jobs[i].cancel();
      jobs.splice(i, 1);
      console.log(`previous job for ${jobs[i].name} removed`);
    }
  }

  let j = schedule.scheduleJob(f, `${d.minute} ${d.hour} * * 0-5`, function() {
    console.log(`job for ${f} started`);
    getRoute(f, start, end);
  });

  jobs.push(j);
  console.log("Total Jobs:", jobs.length);
}

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

function setNotification(f, summary, driveTime) {
  console.log('notification set');
  var notification = new Notification("Morning Route")
      .title(summary)
      .body(driveTime)
      .build();

  var message = new Message("messageId_1046")
      .priority("high")
      .dryRun(false)
      .deliveryReceiptRequested(true)
      .notification(notification)
      .build();

  sendNotification(f, message, notification)
}

function sendNotification(f, message, notification) {
  xcs.sendNoRetry(message, f, function (result) {
      if (result.getError()) {
          console.error(result.getErrorDescription());
      } else {
          console.log("message sent: #" + result.getMessageId());
      }
  });
}
