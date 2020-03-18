var nodemailer = require('nodemailer')

var transporter = nodemailer.createTransport({
  service: 'qq',
  auth: {
    user:'1783728365',
    pass: 'ywuanxmligsmbhbg'
  }
});

module.exports = transporter;