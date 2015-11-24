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

  var fs = require('fs');
  var mailcomposer = require('mailcomposer');
  var MailParser = require('mailparser').MailParser;

  var bucketName = config.bucket;
  var LambdaForwardEmail = require('./lambda-forward-email');
  var forwarder = new LambdaForwardEmail(
    'Forwarder <forwarder@email.net>',
    'emailBucket',
    {
      emailToEmail: {'sint@castle.es': 'santa@north.pole'},
      domainToEmail: {'world.com': 'hello@world.com'},
      domainToDomain: {'blue.com': 'red.com'},
      s3: s3,
      ses: ses
    }
  );

  exports.handler = function(event, context) {
    forwarder.handler(event, context);
  };
}());

