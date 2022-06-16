const { v1: uuidv1 } = require('uuid')
const express = require('express')

const router = express.Router()
const { getPostCollection } = require('../mongo')

const { redirectWithMsg } = require('../util')

router.post('/', async (req, res) => {
  if (!req.user) {
    res.status(403).end()
  }
  const posts = await getPostCollection()
  const { content } = req.body

  posts.insertOne({
    id: uuidv1(),
    userId: req.user.id,
    content,
    createdAt: new Date(),
  })

  redirectWithMsg({
    dest: '/',
    info: '포스트 등록이 완료 되었습니다.',
    res,
  })
})

router.post('/:postId/delete', async (req, res) => {
  const { postId } = req.params
  console.log(postId)
  const posts = await getPostCollection()

  const existingPost = await posts.findOne({
    id: postId,
  })
  console.log(existingPost)

  if (existingPost.userId !== req.user.id) {
    res.status(403).end()
    return
  }

  await posts.deleteOne({
    id: postId,
  })

  redirectWithMsg({
    dest: '/',
    info: '포스트 삭제가 완료되었습니다.',
    res,
  })
})

router.post('/:postId/update', async (req, res) => {
  const { postId } = req.params
  const { content } = req.body
  console.log(postId)
  const posts = await getPostCollection()

  const existingPost = await posts.findOne({
    id: postId,
  })
  console.log(existingPost)

  if (existingPost.userId !== req.user.id) {
    res.status(403).end()
    return
  }

  await posts.updateOne(
    {
      id: postId,
    },
    {
      $set: {
        content,
      },
    }
  )

  redirectWithMsg({
    dest: '/',
    info: '포스트 삭제가 완료되었습니다.',
    res,
  })
})

module.exports = router
