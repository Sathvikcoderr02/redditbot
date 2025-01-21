 Reddit bot that can log into a Reddit account and post a reply to any post.

Instructions:

1. Please run the bot.js using Node with Puppeteer installed. It will run an API server.
2. Once it is running, it will expose an API you can make requests to in order to post a reply to a specified post, for example:

curl -X POST http://localhost:3000/post-reply \
   -H "Content-Type: application/json" \
   -d '{"postUrl": "https://www.reddit.com/r/test/comments/1g8qxa9/hello_world/", "replyText": "This is a test reply!"}'
