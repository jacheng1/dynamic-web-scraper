// dynamic web scraper that fetches the top 10 bestselling video games from target website:
// https://store.steampowered.com/charts/topselling/US

const slackIncomingWebhookUrl = require('./slack_notification_url'); // retrieve webhook URL to send scraped data to designated Slack channel

const puppeteer = require('puppeteer'); // integrate Puppeteer to handle dynamically loaded content on target page
const { z } = require('zod');
const dayjs = require('dayjs');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');

const GameRanking = z.object({
  rank: z.string(),
  title: z.string(),
  price: z.string(),
  rankChange: z.string(),
  weeks: z.string(),
  image: z.string().url(),
});

async function main() {
  const browser = await puppeteer.launch({ headless: false }); // run in non-headless mode for debugging
  const page = await browser.newPage();
  
  try {
    await page.goto('https://store.steampowered.com/charts/topselling/US', {
      waitUntil: 'networkidle0',
    });

    const tableSelector = 'table tbody tr'; // wait for the table to be visible
    await page.waitForSelector(tableSelector, { visible: true, timeout: 10000 }); // wait up to 10 seconds before timeout

    // scrape the data, store into result
    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));

      return rows.slice(0, 10).map(row => {
        const cells = row.querySelectorAll('td');

        const rank = cells[1]?.innerText.trim(); // retrieve rank from 2nd <td>
        const title = cells[2]?.innerText.trim(); // retrieve title from 3rd <td>
        const price = cells[3]?.innerText.trim(); // retrieve price from 4th <td>
        const rankChange = cells[4]?.innerText.trim() || 'Free'; // retrieve rankChange from 5th <td>
        const weeks = cells[5]?.innerText.trim(); // retrieve weeks from 6th <td>
        const image = cells[2]?.querySelector('img')?.src; // retrieve image from 3rd <td> with <img>

        return {
          rank,
          title,
          price,
          rankChange,
          weeks,
          image
        };
      });
    });

    console.log(result); // print scraped data to console

    const validatedResult = result.map(entry => GameRanking.parse(entry)); // validate and process scraped data

    // save the result to CSV file
    const output = stringify(validatedResult, { header: true, quoted: true });
    const date = dayjs();
    const dateString = date.format('YYYYMMDD_HHmmss');
    const filename = `steam_top10.${dateString}.csv`;

    fs.writeFileSync(filename, output); // write to CSV file

    await sendSlackNotification(validatedResult); // helper function to send validated result as notification to Slack channel
  } 
  catch (error) {
    console.error('An error occurred:', error.message);

    await page.screenshot({ path: 'error_screenshot.png' }); // capture screenshot on error
  } 
  finally {
    await browser.close();
  }
}

main();

/**
 * Send Slack notification
 *
 * @param {z.infer<typeof GameRanking>[]} currEntries
*/
async function sendSlackNotification(currEntries) {
  const blocks = [...currEntries.map(entry => {
      const { rank, title, price, rankChange, weeks, image } = entry;

      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `Rank ${rank}` +
            `\nTitle: ${title || 'N/A'}` +
            `\nPrice: ${price || 'N/A'}` +
            `\nRank change: ${rankChange}` +
            `\nWeeks: ${weeks}`,
        },
        accessory: {
          type: 'image',
          image_url: image,
          alt_text: title,
        },
      };
    }),
  ];

  const slackData = {
    text: `Steam Top 10 data received`,
    blocks: blocks,
  };

  console.log("Sending the following data to Slack:", JSON.stringify(slackData, null, 2)); // log the data being sent to Slack

  const response = await fetch(slackIncomingWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(slackData),
  });

  console.log("Slack response status:", response.status);
  console.log("Slack response status text:", response.statusText);
  console.log("Slack response text:", await response.text());
}