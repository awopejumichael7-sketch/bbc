/* ==========================================================================
   VERSES.JS — Verse of the Day for the login screen.
   Text is King James Version (KJV), which is in the public domain, so it can
   be reproduced here safely with no copyright concerns. The verse shown
   rotates once per calendar day (same verse for everyone that day, changes
   automatically at midnight) — deterministic, so it needs no server, API,
   or network call at all.
   ========================================================================== */
export const VERSES = [
  { text: "Trust in the LORD with all thine heart; and lean not unto thine own understanding.", ref: "Proverbs 3:5" },
  { text: "I can do all things through Christ which strengtheneth me.", ref: "Philippians 4:13" },
  { text: "Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing the word of truth.", ref: "2 Timothy 2:15" },
  { text: "For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.", ref: "Jeremiah 29:11" },
  { text: "But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.", ref: "Isaiah 40:31" },
  { text: "This book of the law shall not depart out of thy mouth; but thou shalt meditate therein day and night.", ref: "Joshua 1:8" },
  { text: "Thy word is a lamp unto my feet, and a light unto my path.", ref: "Psalm 119:105" },
  { text: "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee.", ref: "Joshua 1:9" },
  { text: "And we know that all things work together for good to them that love God, to them who are the called according to his purpose.", ref: "Romans 8:28" },
  { text: "Commit thy works unto the LORD, and thy thoughts shall be established.", ref: "Proverbs 16:3" },
  { text: "Go ye therefore, and teach all nations, baptizing them in the name of the Father, and of the Son, and of the Holy Ghost.", ref: "Matthew 28:19" },
  { text: "All scripture is given by inspiration of God, and is profitable for doctrine, for reproof, for correction, for instruction in righteousness.", ref: "2 Timothy 3:16" },
  { text: "Let no man despise thy youth; but be thou an example of the believers, in word, in conversation, in charity, in spirit, in faith, in purity.", ref: "1 Timothy 4:12" },
  { text: "Whatsoever thy hand findeth to do, do it with thy might.", ref: "Ecclesiastes 9:10" },
  { text: "For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.", ref: "2 Timothy 1:7" },
  { text: "In all thy ways acknowledge him, and he shall direct thy paths.", ref: "Proverbs 3:6" },
  { text: "The fear of the LORD is the beginning of knowledge.", ref: "Proverbs 1:7" },
  { text: "Blessed is the man that walketh not in the counsel of the ungodly... but his delight is in the law of the LORD; and in his law doth he meditate day and night.", ref: "Psalm 1:1-2" },
  { text: "Wherefore, my beloved brethren, let every man be swift to hear, slow to speak, slow to wrath.", ref: "James 1:19" },
  { text: "But grow in grace, and in the knowledge of our Lord and Saviour Jesus Christ.", ref: "2 Peter 3:18" },
  { text: "For the word of God is quick, and powerful, and sharper than any twoedged sword.", ref: "Hebrews 4:12" },
  { text: "Ask, and it shall be given you; seek, and ye shall find; knock, and it shall be opened unto you.", ref: "Matthew 7:7" },
  { text: "Now faith is the substance of things hoped for, the evidence of things not seen.", ref: "Hebrews 11:1" },
  { text: "For where two or three are gathered together in my name, there am I in the midst of them.", ref: "Matthew 18:20" },
  { text: "Let the word of Christ dwell in you richly in all wisdom; teaching and admonishing one another in psalms and hymns and spiritual songs.", ref: "Colossians 3:16" },
  { text: "Train up a child in the way he should go: and when he is old, he will not depart from it.", ref: "Proverbs 22:6" },
  { text: "For with God nothing shall be impossible.", ref: "Luke 1:37" },
  { text: "Draw nigh to God, and he will draw nigh to you.", ref: "James 4:8" },
  { text: "The LORD is my shepherd; I shall not want.", ref: "Psalm 23:1" },
  { text: "Now the just shall live by faith.", ref: "Hebrews 10:38" },
  { text: "For where your treasure is, there will your heart be also.", ref: "Matthew 6:21" },
  { text: "But as many as received him, to them gave he power to become the sons of God, even to them that believe on his name.", ref: "John 1:12" },
  { text: "Finally, be strong in the Lord, and in the power of his might.", ref: "Ephesians 6:10" },
  { text: "And let us not be weary in well doing: for in due season we shall reap, if we faint not.", ref: "Galatians 6:9" },
  { text: "Faith cometh by hearing, and hearing by the word of God.", ref: "Romans 10:17" },
  { text: "For I am not ashamed of the gospel of Christ: for it is the power of God unto salvation to every one that believeth.", ref: "Romans 1:16" },
  { text: "Study to be quiet, and to do your own business, and to work with your own hands.", ref: "1 Thessalonians 4:11" },
  { text: "Let your light so shine before men, that they may see your good works, and glorify your Father which is in heaven.", ref: "Matthew 5:16" },
  { text: "But without faith it is impossible to please him: for he that cometh to God must believe that he is.", ref: "Hebrews 11:6" },
  { text: "The steps of a good man are ordered by the LORD: and he delighteth in his way.", ref: "Psalm 37:23" },
  { text: "Wisdom is the principal thing; therefore get wisdom: and with all thy getting get understanding.", ref: "Proverbs 4:7" },
  { text: "I have set the LORD always before me: because he is at my right hand, I shall not be moved.", ref: "Psalm 16:8" },
  { text: "Be ye kind one to another, tenderhearted, forgiving one another, even as God for Christ's sake hath forgiven you.", ref: "Ephesians 4:32" }
];

/* Same verse for every visitor on a given calendar day; rotates automatically at midnight. */
export function getVerseOfTheDay() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return VERSES[dayOfYear % VERSES.length];
}
