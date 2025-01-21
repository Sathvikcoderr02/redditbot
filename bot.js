const express = require('express');
const puppeteer = require('puppeteer');
require('dotenv').config({ path: './reddit.env' });

const app = express();
const port = process.env.PORT || 3000;

// Reddit credentials
const REDDIT_USERNAME = process.env.REDDIT_USERNAME;
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD;

if (!REDDIT_USERNAME || !REDDIT_PASSWORD) {
  console.error('Error: REDDIT_USERNAME and REDDIT_PASSWORD must be set in the .env file');
  process.exit(1);
}

// Rate limiting
const MIN_WAIT_TIME = 5000; // 5 seconds
const MAX_WAIT_TIME = 15000; // 15 seconds

// Add this near the top of the file with other constants
const DEFAULT_TEST_URL = 'https://www.reddit.com/r/sweatystartup/comments/1g7tnid/feedback_and_advice_on_my_startup_soboards/';

// Increase max retries
const MAX_RETRIES = 5;

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function randomWait() {
  const waitTime = Math.floor(Math.random() * (MAX_WAIT_TIME - MIN_WAIT_TIME + 1) + MIN_WAIT_TIME);
  await wait(waitTime);
}

async function isLoggedIn(page) {
  return await page.evaluate(() => {
    const userMenu = document.querySelector('button[aria-label="Open user menu"]');
    const createPost = document.querySelector('button[aria-label="Create Post"]');
    const userIcon = document.querySelector('img[alt="User avatar"]');
    return userMenu !== null || createPost !== null || userIcon !== null;
  });
}

async function loginToReddit(page) {
  if (await isLoggedIn(page)) {
    console.log('Already logged in');
    return;
  }

  console.log('Navigating to Reddit login page...');
  await page.goto('https://www.reddit.com/login/', { waitUntil: 'networkidle0', timeout: 60000 });
  
  await logPageInfo(page, 'Reddit login page loaded');

  try {
    console.log('Waiting for username field...');
    await page.waitForFunction(() => {
      return document.querySelector('input[name="username"]') || 
             document.querySelector('*').shadowRoot?.querySelector('input[name="username"]');
    }, { timeout: 30000 });

    console.log('Entering credentials...');
    await page.evaluate(() => {
      const findElement = (selector) => {
        return document.querySelector(selector) || 
               document.querySelector('*').shadowRoot?.querySelector(selector);
      };
      const usernameField = findElement('input[name="username"]');
      const passwordField = findElement('input[name="password"]');
      if (usernameField) usernameField.focus();
      if (passwordField) passwordField.focus();
    });

    await page.type('input[name="username"]', REDDIT_USERNAME, {delay: 100});
    await page.keyboard.press('Tab');
    await page.type('input[name="password"]', REDDIT_PASSWORD, {delay: 100});
    
    // Press Tab three times to reach the login button
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    await logLoginFormState(page);

    await wait(500);

    console.log('Clicking login button...');
    await page.keyboard.press('Enter');  // This should click the focused login button

    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
    console.log('Navigation after login complete');

    await randomWait();

    console.log('Login successful');
  } catch (error) {
    console.error('Login process failed. Error:', error);
    await page.screenshot({ path: 'login-failed.png', fullPage: true });
    await logPageInfo(page, 'Login failed');
    throw new Error(`Login failed: ${error.message}`);
  }
}

async function postReply(page, postUrl, replyText) {
  postUrl = postUrl.replace('www.', 'old.');
  try {
    console.log(`Navigating to ${postUrl}`);
    await page.goto(postUrl, { waitUntil: 'networkidle0', timeout: 90000 });
    console.log('Page loaded. Waiting for 5 seconds...');
    await wait(5000);

    console.log('Looking for reply box...');
    const replyBox = await page.waitForSelector('textarea[data-event-action="comment"]', { timeout: 10000 });
    
    if (!replyBox) {
      console.error('Reply box not found');
      await page.screenshot({ path: 'reply-box-not-found.png', fullPage: true });
      throw new Error('Reply box not found');
    }

    console.log('Reply box found. Clicking to focus...');
    await replyBox.click();
    await wait(1000);

    console.log('Typing reply...');
    await page.keyboard.type(replyText, {delay: 50});
    await wait(500);

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    console.log('Taking screenshot of the result...');
    await page.screenshot({ path: 'after-reply-attempt.png', fullPage: true });
    
    console.log('Logging page info after reply attempt...');
    await logPageInfo(page, 'After reply attempt');
  } catch (error) {
    console.error('Error in postReply:', error);
    await page.screenshot({ path: 'post-reply-failed.png', fullPage: true });
    await logPageInfo(page, 'Post reply failed');
    throw error;
  }
}

async function redditBot(postUrl, replyText) {
  const browser = await puppeteer.launch({ 
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
    slowMo: 100
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

  try {
    console.log('Starting Reddit bot...');
    
    console.log('Attempting to log in...');
    await loginToReddit(page);
    
    console.log('Login successful. Waiting for 10 seconds before posting reply...');
    await wait(1000  );

    console.log('Attempting to post reply...');
    await postReply(page, postUrl, replyText);
    
    console.log('Reply posted successfully!');
  } catch (error) {
    console.error('Error in redditBot:', error);
    await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
    await logPageInfo(page, 'Error occurred');
    throw error;
  } finally {
    console.log('Closing browser...');
    await browser.close();
    console.log('Browser closed');
  }
}

function isValidRedditUrl(url) {
  const redditUrlPattern = /^https?:\/\/(www\.)?(old\.)?reddit\.com\/r\/[\w-]+\/comments\/[\w-]+\/.*/;
  return redditUrlPattern.test(url);
}

app.use(express.json());

app.post('/post-reply', async (req, res) => {
  const { postUrl = DEFAULT_TEST_URL, replyText } = req.body;
  
  if (!replyText) {
    return res.status(400).json({ error: 'Missing replyText' });
  }

  if (!isValidRedditUrl(postUrl)) {
    return res.status(400).json({ error: 'Invalid Reddit post URL' });
  }

  try {
    console.log(`Attempting to post reply to ${postUrl}`);
    await redditBot(postUrl, replyText);
    res.json({ message: 'Reply posted successfully' });
  } catch (error) {
    console.error('Error in /post-reply:', error.message);
    res.status(500).json({ 
      error: 'Failed to post reply', 
      details: error.message
    });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'Reddit bot server is running' });
});

app.listen(port, () => {
  console.log(`Reddit bot server listening at http://localhost:${port}`);
});

module.exports = { redditBot };

async function logPageInfo(page, stepName) {
  const url = page.url();
  const content = await page.content();
  const title = await page.title();
  console.log(`Step: ${stepName}`);
  console.log(`Current URL: ${url}`);
  console.log(`Page Title: ${title}`);
  console.log(`Page content (first 1000 characters):`, content.substring(0, 1000) + '...');
  
  // Log all available buttons and links
  const buttonsAndLinks = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('button, a')];
    return elements.map(el => ({
      type: el.tagName.toLowerCase(),
      text: el.textContent.trim(),
      href: el.href || null,
      id: el.id || null,
      class: el.className || null,
      'data-testid': el.getAttribute('data-testid') || null
    }));
  });
  console.log('Available buttons and links:', JSON.stringify(buttonsAndLinks, null, 2));

  // Log the page's HTML structure
  const htmlStructure = await page.evaluate(() => {
    const getStructure = (element, depth = 0) => {
      const children = Array.from(element.children);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || undefined,
        class: element.className || undefined,
        children: children.map(child => getStructure(child, depth + 1))
      };
    };
    return getStructure(document.body);
  });
  console.log('Page HTML structure:', JSON.stringify(htmlStructure, null, 2));
}

async function logLoginFormState(page) {
  const formState = await page.evaluate(() => {
    const findElement = (selector) => {
      return document.querySelector(selector) || 
             document.querySelector('*').shadowRoot?.querySelector(selector);
    };
    const usernameField = findElement('input[name="username"]');
    const passwordField = findElement('input[name="password"]');
    const submitButton = findElement('button[type="submit"]');
    
    return {
      usernameFieldExists: !!usernameField,
      passwordFieldExists: !!passwordField,
      submitButtonExists: !!submitButton,
      submitButtonProperties: submitButton ? {
        tag: submitButton.tagName,
        id: submitButton.id,
        className: submitButton.className,
        textContent: submitButton.textContent.trim(),
        type: submitButton.type,
        visible: window.getComputedStyle(submitButton).display !== 'none',
        disabled: submitButton.disabled,
        attributes: Object.fromEntries(
          Array.from(submitButton.attributes).map(attr => [attr.name, attr.value])
        ),
        isClickable: !submitButton.disabled && window.getComputedStyle(submitButton).pointerEvents !== 'none'
      } : null,
      formHTML: document.querySelector('form') ? document.querySelector('form').outerHTML : 'No form found'
    };
  });
  console.log('Login form state:', JSON.stringify(formState, null, 2));
}
