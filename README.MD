# Lambda email forwarder

This package allows you to forward emails with AWS SES and a S3 bucket using a Lambda function.

## Installation

    npm install

## Configuration

Rename `config.dist.json` to `config.json`.

### IAM

Make sure the executing user has access to SES and S3. 

### Lambda

Create a IAM role for SES to allow it to invoke Lambda functions. The following is an example:

    {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "lambda:InvokeFunction",
                "Condition": {
                    "StringEquals": {
                        "aws:Referer": "YOUR ID"
                    }
                },
                "Resource": "*"
            }
        ]
    }

### S3 bucket

Create a S3 bucket with the following bucket policy:

    {
        "Version": "2012-10-17",
        "Id": "Policy1447677014774",
        "Statement": [
            {
                "Sid": "s3-get-obj",
                "Effect": "Allow",
                "Principal": "*",
                "Action": [
                    "s3:GetObject",
                    "s3:PutObject"
                ],
                "Resource": "YOUR S3 ARN/*"
            },
            {
                "Sid": "s3-get-bucket",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:ListBucket",
                "Resource": "YOUR S3 ARN"
            }
        ]
    }

## Usage

    node_modules/.bin/node-lambda run

## Test

    npm test

## Deployment

    node_modules/.bin/node-lambda deploy
