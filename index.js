var aws = require('aws-sdk');
var config = require('./config.json');

var ses = new aws.SES({
    accessKeyId: config.ses.accessKeyId,
    secretAccessKey: config.ses.secretAccessKey,
    region: config.region
});
var s3 = new aws.S3({
    region: config.region
});

var fs = require('fs');
var mailcomposer = require('mailcomposer');
var MailParser = require('mailparser').MailParser;

var bucketName = config.bucket;

exports.handler = function(event, context) {
    var inbound = event.Records[0].ses;
    var to = inbound.mail.commonHeaders.to.splice(0)[0];
    var address = to.substr(0, to.indexOf('@'));
    var forward = address + config.forward;
    var subject = inbound.mail.commonHeaders.subject;
    var key = inbound.mail.messageId;

    s3.getObject({
        Bucket: bucketName,
        Key: key
    }, function(err, data) {
        if (err) {
            console.log(err, err.stack);
            context.fail();
        } else {
			mail(data);
        }
    });

	function mail(data) {
		var mailparser = new MailParser();
		mailparser.write(new Buffer(data.Body, 'binary'));
		mailparser.end();

		mailparser.on("end", function(mailObj) {
			var attachments = [];

			mailObj.attachments.forEach(function(attachment) {
				attachments.push(
					{
						'filename': attachment.fileName,
						'content': attachment.content,
						'contentDisposition': attachment.contentDisposition,
						'charset': attachment.charset,
						'length': attachment.length
					}
				);
			});

			var mailOptions = {
				from: config.from,
				to: forward,
				subject: subject,
				html: mailObj.html,
				attachments: attachments
			};

			var composer = mailcomposer(mailOptions);

			composer.build(function(err, msg) {
				if (err) {
					console.log(err, err.stack);
				} else {
					ses.sendRawEmail({
						RawMessage: {
							Data: msg
						}
					}, function (err, data) {
						if (err) {
							console.log(err, err.stack);
						}
						else {
							context.succeed("ok");
						}
					});
				}
			});
		});
	}

	function logErrors(err) {
		console.log(err, err.stack);
		context.fail();
	}
};