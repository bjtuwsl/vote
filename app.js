const express = require('express')
const socketIO = require('socket.io')
const cookieParser = require('cookie-parser')
const url = require('url')
const session = require('express-session')
const app = express()
const httpApp = express()
const fs = require('fs')
const http = require('http')
const https = require('https')

// https中间件
const server = https.createServer({
  key: fs.readFileSync('/root/.acme.sh/a.longshao.wang/a.longshao.wang.key'),
  cert: fs.readFileSync('/root/.acme.sh/a.longshao.wang/a.longshao.wang.cer')
}, app)

// const server = http.createServer(app)


const ioServer = socketIO(server)
//const port = 9008
const port1 = 9005

app.locals.pretty = true

app.set('views', __dirname + '/tpl')

userAccountRouter = require('./user-account')
// 设置ioServer
ioServer.on('connection', socket => {
  var path = url.parse(socket.request.headers.referer).path
  console.log(path)
  socket.join(path)
})


// 设置标准头，防止乱码
app.use((req, res, next) => {
  console.log(req.method, req.originalUrl)
  res.set('Content-Type', 'text/html; charset=UTF-8')
  next()
})

//查看上传文件的请求体
// app.post('/register', (req, res, next) => {
//   req.on('data', (data) => {
//     console.log(data.toString())
//   })
// })


//会话
app.use(session({secret: 'my secret', resave: false, cookie: {maxAge: 60000}}))
//cookie中间件
app.use(cookieParser('my secret'))

// 设置一个外部对象
// var sessions = {}

// app.use(function session(req, res, next) {
//   var sessionid = req.cookies.sessionid
//   if(!req.cookies.sessionid) {
//     res.cookie('sessionid', Math.random().toString(16).slice(2))
//   }
//   if(!sessions[sessionid]) {
//     sessions[sessionid] = {}
//   }
//   req.session = sessions[sessionid]
//   next()
// })


// 设置路径
app.use(express.static(__dirname + '/static'))
app.use('/upload',express.static(__dirname + '/upload'))
//解析json请求体的中间件
app.use(express.json())
//解析url编码请求体中间件
app.use(express.urlencoded({
  extended: true
}))

// http重定向到https
//httpApp.use((req,res,next)=>{
//  if(req.protocol=="http"){
//      let protocol = req.protocol=="http"?"https":req.protocol
//      let fullURL = protocol + '://' + 'a.longshao.wang' + req.originalUrl
//      console.log('重定向')
//      res.redirect(302,fullURL)
//  }else {
//    next()
//  }
//})

// 首页
app.get('/', async (req, res, next) => {
  console.log(req.cookies)
  console.log(req.signedCookies)
  if(req.signedCookies.userid) {

    var user = await db.get('SELECT * FROM users WHERE id=?', req.signedCookies.userid)
    res.render('index.pug', {
      user: user
    })
  } else {
    res.send(`
      <div>
        <a href="/register">注册</a>
        <a href="/login">登录</a>
      </div>
    `)
  }
})


// 投票后台逻辑
app.post('/create-vote', async (req, res, next) => {
  var voteInfo = req.body
  var userid = req.signedCookies.userid
  console.log(req.body)
  console.log(req.signedCookies.userid)

  //name = 'foo" OR "1"="1'
  //await db.get(`SELECT * FROM users WHERE name="${name}"`)
  await db.run('INSERT INTO votes (title, desc, userid, singleSelection, deadline, anonymouse) VALUES (?,?,?,?,?,?)',
    voteInfo.title, voteInfo.desc, userid, voteInfo.singleSelection, new Date(voteInfo.deadline).getTime(), voteInfo.anonymouse
  )

  var vote = await db.get('SELECT * FROM votes ORDER BY id DESC LIMIT 1')
  await Promise.all(voteInfo.options.map(option => {
    return db.run('INSERT INTO options (content, voteid) VALUES (?,?)', option, vote.id)
  }))

  res.redirect('/vote/' + vote.id)
})


//创建投票
app.get('/vote/:id', async (req, res, next) => {
  if(req.signedCookies.userid){
    var votePromise = db.get('SELECT * FROM votes WHERE id=?', req.params.id)
    var optionsPromise = db.all('SELECT * FROM options WHERE voteid=?', req.params.id)
    var vote = await votePromise
    var options = await optionsPromise
  
    res.render('vote.pug', {
      vote: vote,
      options: options
    })
  } else {
    res.send(`
      请先注册登录，然后复制链接进入投票， <span id="countDown">3</span>秒后转到首页
      <script>
        var remain = 2
        setInterval(() => {
          countDown.textContent = remain--
        }, 1000)
        setTimeout(() => {
          location.href = '/'
        }, 3000)
      </script>
    `)
  }
})


// 用户投票
app.post('/voteup', async (req, res, next) => {
  var userid = req.signedCookies.userid
  var body = req.body
  var voteid = body.voteid
  
  if(userid == null) {
    res.json(null)
  } else {
    //判断用户是否投票，如果已经投票，则更新；如果没有，则插入
    var voteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, body.voteid)
    
    //修改，已经投过票后就不能更改
    if(voteupInfo) {
      // 这一句可以不用
      // return res.end()
      await db.run('UPDATE voteups SET optionid=? WHERE userid=? AND voteid=?', body.optionid, userid, body.voteid)
    } else {
      await db.run('INSERT INTO voteups (userid, optionid,voteid) VALUES (?,?,?)',
        userid, body.optionid, body.voteid
      )
    }

    var voteups = await db.all('SELECT * FROM voteups WHERE voteid=?', body.voteid)

    ioServer.in(`/vote/${voteid}`).emit('new vote', voteups)

    // console.log(voteups)
    res.json(voteups)
  }
})


// 某个用户获取某个问题的投票信息
app.get('/voteup/:voteid/info', async (req, res, next) => {
  var userid = req.signedCookies.userid
  var voteid = req.params.voteid
  //判断用户是否投票，如果已经投票，则返回投票结果；如果没有，返回null
  var userVoteupInfo = await db.get('SELECT * FROM voteups WHERE userid=? AND voteid=?', userid, voteid)

  if(userVoteupInfo) {
    var voteups = await db.all('SELECT * FROM voteups WHERE voteid=?', voteid)
    res.json(voteups)
  } else {
    res.json(null)
  }
})




app.use('/', userAccountRouter)




//httpApp.listen(port, () => {})
let db
const dbPromise = require('./db')
//不希望数据库没打开，外界就访问了，数据库打开后才开始去listen（开始监听）
dbPromise.then(dbObject => {
  db = dbObject
  server.listen(port1, () => {
    console.log('server listening on port', port1)
  })
})
 
