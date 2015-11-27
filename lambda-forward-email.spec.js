(function() {
  'use strict';

  var bufferEqual = require('buffer-equal');
  var async_ = require('async');
  var fs = require('fs');
  var _   = require('lodash');
  var AWSMock = require('mock-aws-s3');
  var MailParser = require('mailparser').MailParser;
  var mailcomposer = require('mailcomposer');
  var LambdaForwardEmail = require('./lambda-forward-email');

  var EVENT_DATA_TEMPLATE = fs.readFileSync('./test-event.json');
  var DEFAULT_DATE = 'Mon, 1 Jan 2000 00:00:00 -0000';

  var makeSesMock = function(callback) {
    var response = {
      ResponseMetadata: { RequestId: 'c2a82f18-9119-11e5-8f4d-7dddb265f716' },
      MessageId: '000001512f4cfcd9-8db6885c-9aef-4ff9-8268-94c3a67bdfd1-000000'
    };
    return {
      sendRawEmail: function(data, sesCallback) {
        callback(data.RawMessage.Data);
        sesCallback(null, response);
      }
    };
  };

  var sesMock = makeSesMock(function() {});

  var s3Mock = AWSMock.S3({
    params: { Bucket: 'testBucket' }
  });


  var TestData = {
  };

  function addTest(testname, data, finalCallback) {
    var event =  JSON.parse(EVENT_DATA_TEMPLATE);
    event.Records[0].ses.mail.messageId = testname;
    event.Records[0].ses.mail.commonHeaders.to = data.tos.before;
    event.Records[0].ses.mail.commonHeaders.cc = data.ccs.after;
    event.Records[0].ses.mail.commonHeaders.subject = data.subject;
    event.Records[0].ses.mail.commonHeaders.date = DEFAULT_DATE;

    var mailBeforeOptions = {
      from: data.from.before,
      to: data.tos.before,
      cs: data.ccs.before,
      subject: data.subject,
      html: data.html.before,
      text: data.text.before,
      attachments: data.attachments
    };

    var mailAfterOptions = {
      from: data.from.after,
      to: data.tos.after,
      cs: data.ccs.after,
      subject: data.subject,
      html: data.html.after,
      text: data.text.after,
      attachments: data.attachments
    };

    LambdaForwardEmail.addForwardHeader(
      mailAfterOptions,
      data.subject,
      DEFAULT_DATE,
      data.from.before,
      data.tos.before,
      data.ccs.before
    );

    function compose(mailOptions, callback) {
      var composer = mailcomposer(mailOptions);

      composer.build(function(err, mail) {
        callback(err, mail);
      });
    }
    async_.parallel({
      before: function(callback) { compose(mailBeforeOptions, callback); },
      after:  function(callback) { compose(mailAfterOptions, callback); }
    }, function(err, mails) {
      if (err) throw err;
      async_.parallel([
        function(callback) {
          s3Mock.putObject({Key: testname, Body: mails.before}, callback);
        },
        function(callback) {
          parseEmail(mails.after, function(mailObj) {
            callback(null, mailObj);
          });
        }
      ], function(err2, results) {
        if (err2) throw err2;
        TestData[testname] = {
          expected: results[1],
          event: event
        };

        finalCallback();
      });
    });
  }

  var EMAIL_TEMPLATE = {
    tos: {
      before: [],
      after: []
    },
    ccs: {
      before: [],
      after: []
    },
    from: {
      before: 'Jane Doe <janedoe@example.com>',
      after: 'Unit <unit@test.com>'
    },
    subject: 'Hi',
    text: 'Hello world!',
    html: '<html><body><span>Hello world!</span></body></html>' 
  };

  var ATTACHMENTS = [
    {
      filename: 'receipt1.txt',
      content: 'crocodile steak $30',
      contentType: 'text/plain',
      contentTransferEncoding: 'quoted-printable'
    },
    {
      filename: 'receipt2.txt',
      content: 'wodka $30',
      contentType: 'text/plain',
      contentTransferEncoding: 'quoted-printable'
    },
  ];

  var EMAILS = {
    'test1': _.create(EMAIL_TEMPLATE, {
      tos: {
        before: ['sint@castle.es'],
        after: ['santa@north.pole']
      }
    }),
    'test2': _.create(EMAIL_TEMPLATE, {
      tos: {
        before: ['sint@castle.es', 'goodbye@world.com', 'unknown@email.com'],
        after: ['santa@north.pole', 'hello@world.com']
      }
    }),
    'test3': _.create(EMAIL_TEMPLATE, {
      tos: {
        before: ['sint@castle.es', 'goodbye@world.com', 'unknown@email.com'],
        after: ['santa@north.pole', 'hello@world.com']
      },
      ccs: {
        before: ['apple@blue.com', 'unknown@courier.com'],
        after: ['apple@red.com']
      }
    }),
    'test4': _.create(EMAIL_TEMPLATE, {
      tos: {
        before: ['sint@castle.es', 'goodbye@world.com', 'unknown@email.com'],
        after: ['santa@north.pole', 'hello@world.com']
      },
      ccs: {
        before: ['apple@blue.com', 'unknown@courier.com'],
        after: ['apple@red.com']
      },
      attachments: ATTACHMENTS
    }),
    'test5': _.create(EMAIL_TEMPLATE, {
      tos: {
        before: ['unkown@gaurdian.com'],
        after: []
      }
    })
  };

  function parseEmail(string, callback) {
    var mailparser = new MailParser();

    mailparser.write(string);
    mailparser.end();
    mailparser.on('end', callback);
  }

  var FORWARDER_SETTINGS = {
    region: 'eu-west-1',
    s3: s3Mock,
    ses : sesMock,
    mappings: {
      emailToEmail: {'sint@castle.es': 'santa@north.pole'},
      domainToEmail: {'world.com': 'hello@world.com'},
      domainToDomain: {'blue.com': 'red.com'}
    }
  };

  function makeForwarder() {
    return new LambdaForwardEmail(
      'Unit <forward@unit.com>',
      'testBucket',
      FORWARDER_SETTINGS
    );
  }

  function setupTests(callback) {
    var work = [];
    function worker(testid) {
      return function(cb) {
        addTest(testid, EMAILS[testid], cb);
      };
    }

    _.forEach(EMAILS, function(_, testId) {
      work.push(worker(testId));
    });

    async_.parallel(work, function(err) {
      if (err) throw err;

      callback();
    });
  }

  function compareAttachment(attach1, attach2) {
    var keys = ['fileName', 'contentDisposition', 'length', 'contentType', 'checksum', 'transferEncoding'];

    for (var i = 0; i < keys.length; i++) {
      var arg1 = attach1[keys[i]];
      var arg2 = attach2[keys[i]];
      if (arg1 !== arg2)
        return _.template('Expected attachments ${ f1 } and ${ f2 } to have the same ${ key } found ${ arg1 } ${ arg2 }') ({
          f1: attach1.fileName,
          f2: attach2.fileName,
          key: keys[i],
          arg1: arg1,
          arg2: arg2
        });
    }

    // checksum is probably enough
    if (!(bufferEqual(new Buffer(attach1.content), new Buffer(attach2.content)))) {
      return _.template('Expected attachments ${ f1 } and ${ f2 } to have the same content') ({
        f1: attach1.fileName,
        f2: attach2.fileName
      });
    }
    return null;
  }

  function matchMailsAddress(obj1, obj2, name) {
    var getAddress = _.partialRight(_.map, 'address');
    var address1 = getAddress(_.get(obj1, name, []));
    var address2 = getAddress(_.get(obj2, name, []));
    
    var result = address1.length === address2.length && _.isEmpty(_.difference(address1, address2));
    if (!result) {
      return _.template('Expected mails ${ name } to be the same, found ${ ad1 } ${ ad2 }')({
        name: name,
        ad1: address1,
        ad2: address2
      });
    }

    return null;
  }

  var customMatcher = {
    toMatchMailObj: function(){
      return {compare: toMatchMailObj};
    }
  };

  function toMatchMailObj(obj1, obj2) {
    var result = {
      pass: true,
      message: 'The mail objects match.'
    };

    var keys = ['subject', 'html', 'text'];

    if (!obj2) {
      result.pass = false;
      result.message = 'Cannot compare mail object with falsy';
      return result;
    }

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var arg1 = obj1[key];
      var arg2 = obj2[key];

      if (arg1 !== arg2) {
        result.pass = false;
        result.message = _.template('Expected mails to have the same ${ key }, found ${arg1} ${arg2}')({
          key: key,
          arg1: arg1,
          arg2: arg2
        });
        return result;
      }
    }

    var attachments1 = obj1.attachments || [];
    var attachments2 = obj2.attachments || [];
    if (attachments1.length !== attachments2.length) {
      result.pass = false;
      result.message = 'Expected mails to have the same number of attachments, found ' +
        attachments1.length + ' ' + attachments2.length + ' , in first and second mail respectively.';
      return result;
    }

    for (i = 0; i < attachments1.length; i++) {
      var errMessage = compareAttachment(attachments1[i], attachments2[i]);
      if (errMessage) {
        result.pass = false;
        result.message = errMessage;
        return result;
      }
    }

    var addressErrors = _.filter([
      matchMailsAddress(obj1, obj2, 'to'),
      matchMailsAddress(obj1, obj2, 'cc')
    ]);

    if (addressErrors.length > 0) {
      result.pass= false;
      result.message = addressErrors[0];
    }

    return result;
  }

  function makeLambdaContext(callback) {
    return {
      fail: function(msg) {
        callback(msg);
      },
      done: function(arg) {
        callback(null, arg);
      },
      succeed: function(arg) {
        callback(null, arg);
      }
    };
  }

  function runTest(forwarder, event, callback) {
    var context = makeLambdaContext(function(lambdaError) {
      if (lambdaError) {
        callback(lambdaError, null, null);
      }
    });

    forwarder.testCallback = function(sesError, msg) {
      if (sesError) {
        callback(null, sesError, null);
        return;
      }

      parseEmail(msg, function(forwardedMailObj) {
        callback(null, null, forwardedMailObj);
      });
    };

    forwarder.handler(event, context);
  }

  function standardTester(expect, done, expectedMailobj) {
    return function(lambdaError, sesError, forwardedMailObj) {
      expect(lambdaError).toBeFalsy();
      expect(sesError).toBeFalsy();

      expect(forwardedMailObj).toMatchMailObj(expectedMailobj);

      done();
    };
  }

  describe('lambda-forward-email', function() {
    beforeAll(function(done) {
      jasmine.addMatchers(customMatcher);
      setupTests(done);
    });

    describe('email translation email',function(){
      it('should translate', function() {
        var forwarder = makeForwarder();
        expect(forwarder.translateEmail('no an email')).toBe(null);
        expect(forwarder.translateEmail('sint@castle.es')).toBe('santa@north.pole');
        expect(forwarder.translateEmail('goodbye@world.com')).toBe('hello@world.com');
        expect(forwarder.translateEmail('color@blue.com')).toBe('color@red.com');
      });
    });

    describe('should add forwarding text', function() {
      it('without cc', function(){
        var mail = {
          text: 'Hello world!',
          html: '<html><body><span>Hello world!</span></body></html>' 
        };
        LambdaForwardEmail.addForwardHeader(
          mail,
          'Hello World',
          DEFAULT_DATE,
          'Jane Doe <janedoe@example.com>',
          ['a@letter.me', 'b@letter.me']
        );

        expect(mail.text).toBe([
          '-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe <janedoe@example.com>',
          'To:         a@letter.me, b@letter.me',
          'Hello world!'
        ].join('\n'));
        expect(mail.html).toBe([
          '<html><body><span>-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe &lt;janedoe@example.com&gt;',
          'To:         a@letter.me, b@letter.me' +
            '</span><span>Hello world!</span></body></html>'
        ].join('\n'));
      });

      it('with cc', function(){
        var mail = {
          text: 'Hello world!',
          html: '<html><body><span>Hello world!</span></body></html>' 
        };
        LambdaForwardEmail.addForwardHeader(
          mail,
          'Hello World',
          DEFAULT_DATE,
          'Jane Doe <janedoe@example.com>',
          ['a@letter.me', 'b@letter.me'],
          ['d@letter.me', 'e@letter.me']
        );

        expect(mail.text).toBe([
          '-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe <janedoe@example.com>',
          'To:         a@letter.me, b@letter.me',
          'Cc:         d@letter.me, e@letter.me',
          'Hello world!'
        ].join('\n'));
        expect(mail.html).toBe([
          '<html><body><span>-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe &lt;janedoe@example.com&gt;',
          'To:         a@letter.me, b@letter.me',
          'Cc:         d@letter.me, e@letter.me'  +
            '</span><span>Hello world!</span></body></html>'
        ].join('\n'));
      });

      it('with cc, no body tag in html', function(){
        var mail = {
          text: 'Hello world!',
          html: '<span>Hello world!</span>' 
        };
        LambdaForwardEmail.addForwardHeader(
          mail,
          'Hello World',
          DEFAULT_DATE,
          'Jane Doe <janedoe@example.com>',
          ['a@letter.me', 'b@letter.me'],
          ['d@letter.me', 'e@letter.me']
        );

        expect(mail.text).toBe([
          '-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe <janedoe@example.com>',
          'To:         a@letter.me, b@letter.me',
          'Cc:         d@letter.me, e@letter.me',
          'Hello world!'
        ].join('\n'));
        expect(mail.html).toBe([
          '<span>-------- Forwarded Message --------',
          'Subject:    Hello World',
          'Date:       Mon, 1 Jan 2000 00:00:00 -0000',
          'From:       Jane Doe &lt;janedoe@example.com&gt;',
          'To:         a@letter.me, b@letter.me',
          'Cc:         d@letter.me, e@letter.me</span>',
          '<span>Hello world!</span>'
        ].join('\n'));
      });

    });

    describe('should forward email', function() {
      it('with single to', function(done) {
        var testData = TestData.test1;
        runTest(makeForwarder(), testData.event, standardTester(expect, done, testData.expected));
      });

      it('with multiple to', function(done) {
        var testData = TestData.test2;
        runTest(makeForwarder(), testData.event, standardTester(expect, done, testData.expected));
      });

      it('with multiple to and cc', function(done) {
        var testData = TestData.test3;
        runTest(makeForwarder(), testData.event, standardTester(expect, done, testData.expected));
      });

      it('with multiple to and cc and attachments', function(done) {
        var testData = TestData.test4;
        runTest(makeForwarder(), testData.event, standardTester(expect, done, testData.expected));
      });

    });

    it('should fail when no mapping is available for the target email', function(done) {
      var testData = TestData.test5;
      runTest(makeForwarder(), testData.event, function(lambdaError) {
        expect(lambdaError).toBe('None of the mails has a mapping.');
        done();
      });
    });

  });

})();
