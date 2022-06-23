// @ts-check
const express = require('express')
const { v4: uuidv4 } = require('uuid')
const { SESV2 } = require('aws-sdk')

const { APP_CONFIG_JSON } = require('../common')
const { getUsersCollection, getPostCollection } = require('../mongo')
const {
  setAccessTokenCookie,
  encryptPassword,
  comparePassword,
  getAccessTokenForUserId,
} = require('../auth/auth')
const { signJWT } = require('../auth/jwt')

const { redirectWithMsg } = require('../util')

const HOST = 'd3bd-58-127-18-58.jp.ngrok.io'

const router = express.Router()
console.log('add fake commit')
const ses = new SESV2({
  accessKeyId: process.env.AWS_ACCESS_KET_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
})

router.get('/', async (req, res) => {
  if (req.user) {
    const postsCol = await getPostCollection()

    const postsCursor = postsCol.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'users',
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ])

    const posts = (await postsCursor.toArray()).map(({ users, ...rest }) => ({
      ...rest,
      user: users[0],
    }))

    res.render('home', {
      user: req.user,
      posts,
      APP_CONFIG_JSON,
    })
  } else {
    res.render('signin', {
      APP_CONFIG_JSON,
    })
  }
})

router.get('/request-reset-password', (req, res) => {
  res.render('request-reset-password', {
    APP_CONFIG_JSON,
  })
})

router.get('/reset-password', async (req, res) => {
  const { code } = req.query

  const users = await getUsersCollection()

  const user = await users.findOne({
    passwordResetCode: code,
  })

  console.log(user)

  if (!user || !user.pendingPassword) {
    res.status(400).end()
    return
  }

  const { pendingPassword } = user

  await users.updateOne(
    {
      id: user.id,
    },
    {
      $set: {
        password: pendingPassword,
        pendingPassword: null,
      },
    }
  )
  redirectWithMsg({
    dest: '/',
    info: '비밀번호가 변경되었습니다. 해당 비밀번호로 로그인 해 주세요.',
    res,
  })
})

router.post('/request-reset-password', async (req, res) => {
  if (!req.body) {
    res.status(400).end()
    return
  }

  const { email, password } = req.body
  const users = await getUsersCollection()

  if (!email || !password) {
    redirectWithMsg({
      dest: '/request-reset-password',
      error: '이메일과 비밀번호를 모두를 입력해주세요.',
      res,
    })
    return
  }

  const existingUser = await users.findOne({
    email,
  })

  if (!existingUser) {
    redirectWithMsg({
      dest: '/request-reset-password',
      error: '존재하지 않는 이메일입니다.',
      res,
    })
    return
  }

  const passwordResetCode = uuidv4()

  await ses
    .sendEmail({
      Content: {
        Simple: {
          Subject: {
            Data: '비밀번호 초기화',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: `다음 링크를 눌러 비밀번호를 초기화 합니다. https://${HOST}/reset-password?code=${passwordResetCode}`,
              Charset: 'UTF-8',
            },
          },
        },
      },
      Destination: {
        ToAddresses: [email],
      },
      FromEmailAddress: 'admin@davidyoonproject.com',
    })
    .promise()

  await users.updateOne(
    {
      id: existingUser.id,
    },
    {
      $set: {
        pendingPassword: await encryptPassword(password),
        passwordResetCode,
      },
    }
  )

  redirectWithMsg({
    dest: '/',
    info: '비밀번호 초기화 요청이 전송되었습니다. 이메일을 확인해 주세요.',
    res,
  })
})

router.get('/signup', (req, res) => {
  res.render('signup', {
    APP_CONFIG_JSON,
  })
})

router.post('/signin', async (req, res) => {
  if (!req.body) {
    redirectWithMsg({
      res,
      dest: '/',
      error: '잘못된 요청입니다.',
    })
    return
  }

  const users = await getUsersCollection()
  const { email, password } = req.body

  if (!email || !password) {
    redirectWithMsg({
      res,
      dest: '/',
      error: '이메일과 비밀번호를 모두 입력해주세요.',
    })
    return
  }

  const existingUser = await users.findOne({
    email,
  })

  if (!existingUser) {
    redirectWithMsg({
      dest: '/',
      error: '정보에 맞는 데이터가 존재하지 않습니다.',
      res,
    })
    return
  }

  const isPasswordCorrect = await comparePassword(
    password,
    existingUser.password
  )

  if (isPasswordCorrect) {
    const token = await getAccessTokenForUserId(existingUser.id)
    setAccessTokenCookie(res, token)
    redirectWithMsg({
      dest: '/',
      info: '로그인 되었습니다.',
      res,
    })
  } else {
    redirectWithMsg({
      dest: '/',
      error: '정보에 맞는 데이터가 존재하지 않습니다.',
      res,
    })
  }
})

router.get('/verify-email', async (req, res) => {
  const { code } = req.query
  if (!code) {
    res.status(400).end()
    return
  }

  const users = await getUsersCollection()

  const user = await users.findOne({
    emailVerificationCode: code,
  })

  if (!user) {
    res.status(400).end()
    return
  }

  await users.updateOne(
    {
      id: user.id,
    },
    {
      $set: {
        verified: true,
      },
    }
  )

  redirectWithMsg({
    dest: '/',
    info: '이메일이 인증되었습니다',
    res,
  })
})

router.post('/signup', async (req, res) => {
  const users = await getUsersCollection()
  const { email, password } = req.body

  if (!email || !password) {
    redirectWithMsg({
      dest: '/signup',
      error: '이메일과 비밀번호를 모두 입력해야 합니다.',
      res,
    })
    return
  }
  const existingUser = await users.findOne({
    email,
  })

  if (existingUser) {
    redirectWithMsg({
      dest: '/signup',
      error: '해당 이메일을 사용하는 유저가 이미 존재합니다.',
      res,
    })
  }

  const newUserId = uuidv4()
  const emailVerificationCode = uuidv4()
  await ses
    .sendEmail({
      Content: {
        Simple: {
          Subject: {
            Data: '이메일 인증 요청',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: `다음 링크를 눌러 이메일 인증을 진행해주세요. https://${HOST}/verify-email?code=${emailVerificationCode}`,
              Charset: 'UTF-8',
            },
          },
        },
      },
      Destination: {
        ToAddresses: [email],
      },
      FromEmailAddress: 'admin@davidyoonproject.com',
    })
    .promise()

  await users.insertOne({
    id: newUserId,
    email,
    password: await encryptPassword(password),
    verified: false,
    emailVerificationCode,
  })

  setAccessTokenCookie(res, await signJWT(newUserId.toString()))
  res.redirect('/')
})

router.get('/logout', (req, res) => {
  res.clearCookie('access_token')
  res.redirect('/')
})

module.exports = router
