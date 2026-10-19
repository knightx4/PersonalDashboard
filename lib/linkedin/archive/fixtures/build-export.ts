// Writes export.zip beside this file: a small synthetic LinkedIn export, every
// person, company and message in it made up. The archive tests read the zip;
// they never read a real export. Run again after changing a file below:
//
//   npx tsx lib/linkedin/archive/fixtures/build-export.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

const FILES: Record<string, string> = {
  // Part one and part two of the applications. The second part repeats the
  // first part's Acme row, which the reader keeps once.
  'Jobs/Job Applications.csv': [
    'Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers',
    '"6/13/26, 11:26 PM",sam@example.com,555-0100,Acme Robotics,Product Manager,https://www.linkedin.com/jobs/view/4012345678,Sam Taylor CV.pdf,"How many years of product management experience do you have?:6 | Are you legally authorized to work in the United States?:Yes | What time can you start?:9:30 | Pick one:A | B"',
    '"1/2/26, 12:05 AM",sam@example.com,,Globex,Senior Analyst,http://www.linkedin.com/jobs/view/3999999999/,Sam Taylor CV.pdf,',
  ].join('\n'),
  'Jobs/Job Applications_1.csv': [
    'Application Date,Contact Email,Contact Phone Number,Company Name,Job Title,Job Url,Resume Name,Question And Answers',
    '"6/13/26, 11:26 PM",sam@example.com,555-0100,Acme Robotics,Product Manager,https://www.linkedin.com/jobs/view/4012345678,Sam Taylor CV.pdf,"How many years of product management experience do you have?:6"',
    '"12/1/25, 12:40 PM",sam@example.com,,Initech,Operations Lead,,Sam Taylor CV.pdf,"Notice period:2 weeks"',
  ].join('\n'),
  'Jobs/Job Applicant Saved Answers.csv': [
    'Question,Answer',
    'Mobile phone number,555-0100',
    '"Are you willing to relocate?",No',
  ].join('\n'),
  'Jobs/Job Applicant Saved Screening Question Responses.csv': [
    'Question,Answer',
    'How many years of experience do you have with SQL?,5',
  ].join('\n'),
  'Jobs/Saved Jobs.csv': [
    'Saved Date,Job Url,Job Title,Company Name',
    '"8/21/26, 3:14 PM",https://www.linkedin.com/jobs/view/4087654321,Head of Product,Umbrella Health',
  ].join('\n'),
  'Jobs/Job Seeker Preferences.csv': [
    'Locations,Industries,Company Employee Count,Preferred Job Types,Job Titles,Open To Recruiters,Dream Companies,Introduction Statement',
    '"Denver, Colorado | Remote",Software Development,,Full-time,Product Manager | Product Lead,Yes,,Product manager who likes hard problems.',
  ].join('\n'),
  'Jobs/SavedJobAlerts.csv': [
    'Alert Date,Alert Parameters,Saved Search Id',
    '2026-08-01 09:00:00 UTC,keywords=product manager&location=Denver,77001',
  ].join('\n'),

  // Connections opens with three lines of notes before its header.
  'Connections.csv': [
    'Notes:',
    '"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address using this setting https://www.linkedin.com/psettings/privacy/email. You can learn more here https://www.linkedin.com/help/linkedin/answer/261"',
    '',
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Jordan,Lee,https://www.linkedin.com/in/jordan-lee-4b2a1c,,Acme Robotics,Recruiter,21 Aug 2026',
    'Renée,Dubois,https://www.linkedin.com/in/Ren%C3%A9e-Dubois/,renee@example.com,Globex,Director of Product,03 Jan 2025',
  ].join('\n'),
  // A message whose content runs over several lines, inside quotes.
  'messages.csv': [
    'CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER,ATTACHMENTS,IS MESSAGE DRAFT',
    '2-ZmFrZWNvbnZv,,Jordan Lee,https://www.linkedin.com/in/jordan-lee-4b2a1c,Sam Taylor,https://www.linkedin.com/in/sam-taylor-0a1b2c,2026-08-21 15:14:57 UTC,Product Manager role,"Hi Sam,',
    '',
    'Thanks for applying, ""PM"" role. Free for a call Tuesday?',
    'Jordan",INBOX,,No',
    '2-ZmFrZWNvbnZv,,Sam Taylor,https://www.linkedin.com/in/sam-taylor-0a1b2c,Jordan Lee,https://www.linkedin.com/in/jordan-lee-4b2a1c,2026-08-21 16:02:10 UTC,,Tuesday works.,INBOX,,No',
  ].join('\n'),
  'Invitations.csv': [
    'From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl',
    'Sam Taylor,Renée Dubois,"1/3/25, 8:00 AM",Enjoyed your talk.,OUTGOING,https://www.linkedin.com/in/sam-taylor-0a1b2c,https://www.linkedin.com/in/Ren%C3%A9e-Dubois/',
  ].join('\n'),
  'Company Follows.csv': [
    'Organization,Followed On',
    'Acme Robotics,Fri Aug 21 19:02:55 UTC 2026',
  ].join('\n'),
  'Positions.csv': [
    'Company Name,Title,Description,Location,Started On,Finished On',
    'Hooli,Product Manager,"Led the payments team.',
    'Shipped two launches.","Denver, Colorado",Jul 2025,',
    'Initrode,Analyst,,,2016,Jun 2025',
  ].join('\n'),
  'Education.csv': [
    'School Name,Start Date,End Date,Notes,Degree Name,Activities',
    'State University,2012,2016,,BSc Economics,Debate',
  ].join('\n'),
  'Courses.csv': ['Name,Number', 'Econometrics,ECON 301'].join('\n'),
  'Certifications.csv': [
    'Name,Url,Authority,Started On,Finished On,License Number',
    'Certified Scrum Product Owner,https://example.com/cert/1,Scrum Alliance,Mar 2024,Mar 2026,CSPO-123',
  ].join('\n'),
  'Honors.csv': ['Title,Description,Issued On', "Dean's List,Top 5%,Dec 2015"].join('\n'),
  'Skills.csv': ['Name', 'Product Management', 'SQL'].join('\n'),
  'Learning.csv': [
    'Content Title,Content Description,Content Type,Content Last Watched Date (if viewed),Content Completed At (if completed),Content Saved,Notes taken on videos (if taken)',
    'Product Discovery,How to find what to build.,Course,2026-07-02 18:40 UTC,2026-07-03 20:15 UTC,false,',
  ].join('\n'),
  'Receipts_v2.csv': [
    'Transaction Made At,Card Type,Currency Code,Sub Total,Tax Amount,Total Amount,Product Name,Invoice Number,Payment Method',
    '2026-05-01 10:00:00 UTC,VISA,USD,39.99,3.20,43.19,Premium Career,INV-0001,Card',
  ].join('\n'),
  'Private_identity_asset.csv': [
    'Private Identity Asset Name,Private Identity Asset Raw Text',
    'Sam Taylor CV.pdf,"Sam Taylor',
    'Product Manager"',
  ].join('\n'),

  // Files the reader does not read; they are listed as unread.
  'Profile.csv': 'First Name,Last Name\nSam,Taylor',
  'Ad_Targeting.csv': 'Member Age\n25 to 34',
};

const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
const mtime = new Date('2026-10-01T00:00:00Z');
for (const [path, text] of Object.entries(FILES)) {
  entries[path] = [strToU8(text + '\n'), { mtime }];
}

writeFileSync(join(import.meta.dirname, 'export.zip'), zipSync(entries, { level: 6 }));
console.log(`wrote export.zip with ${Object.keys(FILES).length} files`);
