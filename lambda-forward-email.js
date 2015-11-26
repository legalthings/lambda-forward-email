(function (){
  'use strict';

  var fs = require('fs');
  var aws = require('aws-sdk');
  var cheerio = require('cheerio');
  var mailcomposer = require('mailcomposer');
  var MailParser = require('mailparser').MailParser;
  var _ = require('lodash');

  function LambdaForwardEmail(from, bucketName, options) {
    var awsOptions = {};
    options = options || {};

    if (options.region) {
      awsOptions.region = options.region;
    }

    this.s3 = options.s3 || new aws.S3(awsOptions);
    this.ses = options.ses || new aws.SES(awsOptions);
    this.testCallback = options.testCallback || function() {};

    this.from = from;

    this.bucketName = bucketName;

    // email faill in only one of these categories.
    this.mappings = {};

    this.mappings.emailToEmail   = options.mappings.emailToEmail   || {};
    this.mappings.domainToEmail  = options.mappings.domainToEmail  || {};
    this.mappings.domainToDomain = options.mappings.domainToDomain || {};
  }

  var forwardTemplate = _.template([
    '-------- Forwarded Message --------',
    'Subject:    ${subject}',
    'Date:       ${date}',
    'From:       ${from}',
    'To:         ${to}'
  ].join('\n'));

  LambdaForwardEmail.addForwardHeader = function (mailObj, subject, originalDate, originalSender, tos, ccs) {
    var forwardHeader = forwardTemplate(
      {subject:subject,
       date: originalDate,
       from: originalSender,
       to: tos.join(', ')
      });

    if (ccs && ccs.length > 0) {
      forwardHeader += '\n' + 'Cc:         ' + ccs.join(', ');
    }

    if (mailObj.text) {
      mailObj.text = forwardHeader +'\n' + mailObj.text;
    }

    if (mailObj.html){
      var $ = cheerio.load(mailObj.html);
      var span = $('<span />').text(forwardHeader);

      if (mailObj.html.match(/body/i)) {
        // bugs in escaping could lead to security issues
        $('body').prepend(span);
        var newHtml = $.html();
        mailObj.html = newHtml;
      }
      else {
        // get outer html
        var temp = $('<div>').append($(span).clone()).html();
        mailObj.html = temp + '\n' + mailObj.html;
      }
    }
  };


  LambdaForwardEmail.prototype.translateEmail = function(email) {
    if (email in this.mappings.emailToEmail) {
      return this.mappings.emailToEmail[email];
    }

    var temp = (email + '@').split('@');
    var domain = temp[1];
    var to = temp[0];

    if (domain in this.mappings.domainToEmail) {
      return this.mappings.domainToEmail[domain];
    }
    else if (domain in this.mappings.domainToDomain) {
      return to + '@' + this.mappings.domainToDomain[domain];
    }

    return null;
  };

  LambdaForwardEmail.prototype.handler = function(event, context) {
    var s3 = this.s3;
    var ses = this.ses;
    var that = this;

    var inbound = event.Records[0].ses;
    var subject = inbound.mail.commonHeaders.subject;
    var key = inbound.mail.messageId;

    var originalSender = inbound.mail.commonHeaders.from;
    var originalDate = inbound.mail.commonHeaders.date;

    var inboundTos = inbound.mail.commonHeaders.to || [];
    var inboundCCs = inbound.mail.commonHeaders.cc || [];
    var tos = [];
    var ccs = [];

    inboundTos.forEach(function(to) {
      var translatedTo = that.translateEmail(to);

      if (translatedTo) tos.push(translatedTo);
    });

    inboundCCs.forEach(function(cc) {
      var translatedCc = that.translateEmail(cc);

      if (translatedCc) ccs.push(translatedCc);
    });

    if (tos.length === 0 && ccs.length === 0) {
      return context.fail('None of the mails has a mapping.');
    }

    s3.getObject({
      Bucket: that.bucketName,
      Key: key
    }, function(err, data) {
      if (err) {
        console.warn(err, err.stack);
        return context.fail(err);
      }

      mail(data, function(err, arg) {
        if (err) {
          console.warn(err, err.stack);
          return context.fail(err);
        }

        return context.succeed('Forwarded e-mail for ' + inbound.mail.commonHeaders.to + ' to ' + tos);
      });
    });

    function mail(data, callback) {
      var mailparser = new MailParser();
      mailparser.write(new Buffer(data.Body, 'binary'));
      mailparser.end();

      mailparser.on("end", function(mailObj) {
        var attachments = [];

        if (mailObj.attachments) {
          // difference in generatedFileName and fileName might produce problems
          mailObj.attachments.forEach(function(attachment) {
            attachments.push({
              'filename': attachment.fileName,
              'content': attachment.content,
              'contentDisposition': attachment.contentDisposition,
              'charset': attachment.charset,
              'length': attachment.length,
              'contentType': attachment.contentType
            });
          });
        }

        LambdaForwardEmail.addForwardHeader(
          mailObj,
          subject,
          originalDate,
          originalSender,
          inboundTos,
          inboundCCs
        );
        var mailOptions = {
          from: that.from,
          to: tos,
          cc: ccs,
          subject: subject,
          html: mailObj.html,
          text: mailObj.text,
          attachments: attachments
        };

        var composer = mailcomposer(mailOptions);

        composer.build(function(err, msg) {
          if (err) {
            that.testCallback(err);
            return callback(err);
          };
          ses.sendRawEmail({
            RawMessage: { Data: msg }
          }, function(sesError, arg) {
            that.testCallback(sesError, msg);
            callback(sesError, arg);
          });
        });
      });
    }

  };

  module.exports = LambdaForwardEmail;
}());
