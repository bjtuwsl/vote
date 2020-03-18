const express = require('express')
const app = express.Router()
const md5 = require('md5')
const jimp = require('jimp')
const svgCaptcha = require('svg-captcha')
const multer = require('multer')
const uploader = multer({
  dest: './upload/'
})

let db
const dbPromise = require('./db')
dbPromise.then(dbObject => {
  db = dbObject
})

const changePasswordTokenMap = {}
const mailer = require('./mailer')
//注册页面
// 这个页面接受两种请求，所以可以使用route
app.route('/register')
 .get((req, res, next) => {
   //两种页面，get请求发送这个页面，post请求就注册
    res.send(`
      <form action="/register" method="post" enctype="multipart/form-data">
        用户名:<input type="text" name="name"/><br>
        邮箱:<input type="text" name="email"/><br>
        密码:<input type="password" name="password"/><br>
        头像：<input type="file" name="avatar"><br>
        <button>注册</button>
      </form>
    `)
  })
  .post(uploader.single('avatar'), async (req, res, next) => {
    var regInfo = req.body
    // 利用数据库查询
    console.log("=====",regInfo.password)
    console.log('avatar', req.file)
    // jimp压缩
    if(!req.file) {
      res.end(`
      <script>
        alert('未传头像，请重新注册')
        location.href = "/"
      </script>
      `)
      return
    }
    jimp.read(req.file.path).then(lenna => {
      return lenna.resize(256, 256).write(req.file.path)
    }).catch(err => {
      console.log(err)
    })
    // 验证用户
    var user = await db.get('SELECT * FROM users WHERE name=?', regInfo.name)
    if(user) {
      res.end('用户名被占用')
    } else {
      await db.run('INSERT INTO users (name, email, password, avatar) VALUES (?,?,?,?)', 
        regInfo.name, regInfo.email, md5(md5(regInfo.password)), req.file.path
      )
      res.send(`
        <script>
          alert('注册成功,请登录')
          location.href="/login"
        </script>
      `)
    }
  })


// 验证码中间键
app.get('/captcha', (req, res, next) => {
  var captcha = svgCaptcha.create({
    ignoreChars:'0o1il',
    color: true
  })
  res.type('svg')
  req.session.captcha = captcha.text
  
  res.end(captcha.data)
})

//登录页面
app.route('/login')
  .get((req, res, next) => {
    res.send(`
      <form id="loginForm" action="/login" method="post">
        用户名:<input type="text" name="name"/><br>
        密码:<input type="password" name="password"/><br>
        <img id="captchaImg" src='/captcha'><br>
        验证码：<input type="text" name="captcha">
        <a href="forgot">忘记密码<a><br>
        <button>登录</button>
      </form>

      <script>
        captchaImg.onclick = () => {
          captchaImg.src = '/captcha?' + Date.now()
        }
        loginForm.onsubmit = e => {
          e.preventDefault()//阻止默认表单提交
          var name = document.querySelector('[name="name"]').value
          var password = document.querySelector('[name="password"]').value
          var captcha = document.querySelector('[name="captcha"]').value
          
          // 发送ajax修改页面
          var xhr = new XMLHttpRequest()
          xhr.open('POST', '/login')
          xhr.onload = () => {
            var data = JSON.parse(xhr.responseText)
            if(data.code == 0) {
              alert('login success, will redirected to homePage')
              location.href = '/'
            } else {
              alert('login failed')
              location.href = '/login'
            }
          }
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
          xhr.send('name=' + name + '&password=' + password + '&captcha=' + captcha)
        }
      </script>
    `)
  })
  .post(async (req, res, next) => {
    var tryloginUser = req.body
    if(tryloginUser.captcha != req.session.captcha) {
      res.json({code: -1, msg: '验证码错误'})
      return
    }
    var user = await db.get('SELECT * FROM users WHERE name=? AND password=?', 
    tryloginUser.name, md5(md5(tryloginUser.password)))
    if(user) {
      res.cookie('userid', user.id, {
        signed:true
      })
      // res.redirect('/')
      res.json({code: 0})
    } else {
      res.json({code: -1, msg:'用户名或密码错误'})
      // res.end('用户名或密码错误')
    }
  })



//忘记密码功能
app.route('/forgot')
  .get((req, res, next) => {
    res.end(`
      <form action="/forgot" method="post">
        请输入您的邮箱:<input type="text" name="email"/>
        <button>确定</button>
      <form>
    `)
  })
  .post(async (req, res, next) => {
    var email = req.body.email
    var token = Math.random().toString().slice(2)
    var user = await db.get('SELECT * FROM users WHERE email=?', email)
    if(user) {
      changePasswordTokenMap[token] = email
      
      setTimeout(() => {
        delete changePasswordTokenMap[token]
      }, 60 * 1000 * 20) //20分钟后链接失效
  
      var link = `http://localhost:9005/change-password/${token}`
      console.log(link)

      mailer.sendMail({
        from: '1783728365@qq.com',
        to: email,
        subject: '密码修改',
        text: link
      }, (err, info) => {
        res.end('已向您的邮箱发送密码重置链接,请于20分钟内修改密码')
      })

      // EmaliSystem.send(email, link)
      //http://localhost:3005/change-password/2134123491283
    } else {
      res.end('不存在此用户')
    }
  })


//邮箱页面操作
app.route('/change-password/:token')
  .get((req, res, next) => {
    var token = req.params.token
    var email = changePasswordTokenMap[token];
    if(!email) {
      res.end('链接已失效')
      return
    }
    res.end(`
      此页面可以重置${email}邮箱用户的密码
      <form action="" method="post">
        <input type="password" name="password"/>
        <button>提交</button>
      <form>
    `)
  })
  .post(async (req, res, next) => {
    var token = req.params.token
    var email = changePasswordTokenMap[token];
    var password = req.body.password
    console.log(req.body)//查看请求体
    if(email) {
      await db.run('UPDATE users SET password=? WHERE email=?', md5(md5(password)), email)
      // 修改成功，让token立即失效
      delete changePasswordTokenMap[token]

      res.end('密码修改成功')
    } else {
      res.end('此链接已经失效')
    }
  })

//登出功能
app.get('/logout', (req, res, next) => {
  res.clearCookie('userid')
  res.redirect('/')
})

module.exports = app