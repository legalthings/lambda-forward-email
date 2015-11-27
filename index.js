(function(){
  'use strict';

  var aws = require('aws-sdk');
  var config = require('./config.json');

  var ses = new aws.SES({
    region: config.region
  });
  var s3 = new aws.S3({
    region: config.region
  });

  var LambdaForwardEmail = require('./lambda-forward-email');
  var forwarder = new LambdaForwardEmail(
    config.from,
    config.bucket,
    {
      mappings: config.mappings,
      s3 : s3,
      ses: ses
    }
  );

  exports.handler = function(event, context) {
    forwarder.handler(event, context);
  };
}());

