export interface Quote {
  quote: string;
  author: string;
  category: string;
}

export const planningQuotes: Quote[] = [
  { quote: "Plans are worthless, but planning is everything.", author: "Dwight D. Eisenhower", category: "philosophical" },
  { quote: "It is better to be roughly right than precisely wrong.", author: "John Maynard Keynes", category: "philosophical" },
  { quote: "Hofstadter's Law: It always takes longer than you expect, even when you take into account Hofstadter's Law.", author: "Douglas Hofstadter", category: "philosophical" },
  { quote: "The conversations about the estimate are much more valuable than the estimate itself.", author: "Mike Cohn", category: "philosophical" },
  { quote: "An estimate is a prediction of the future, and predictions are notoriously difficult, especially about the future.", author: "Yogi Berra", category: "philosophical" },
  { quote: "Estimation is not an act of calculations; it is an act of negotiation.", author: "Ron Jeffries", category: "philosophical" },
  { quote: "Perfect precision is an illusion that breeds a false sense of security.", author: "Steve McConnell", category: "philosophical" },
  { quote: "The primary purpose of software estimation is not to predict the future, but to determine if a project's targets are realistic.", author: "Steve McConnell", category: "philosophical" },
  { quote: "Fast, cheap, good: pick two.", author: "The Iron Triangle Principle", category: "philosophical" },
  { quote: "If you don't know where you are going, any road will get you there.", author: "Lewis Carroll", category: "philosophical" },
  { quote: "The first 90% of the code accounts for the first 90% of the development time. The remaining 10% of the code accounts for the other 90% of the development time.", author: "Tom Cargill", category: "funny" },
  { quote: "Every story point estimation is just an educated guess wrapped in a countdown timer.", author: "Anonymous Developer", category: "funny" },
  { quote: "There are two ways to write error-free programs; only the third one works.", author: "Alan J. Perlis", category: "funny" },
  { quote: "Walking on water and developing software from a specification are easy if both are frozen.", author: "Edward V. Berard", category: "funny" },
  { quote: "It works on my machine.", author: "Every Developer Ever", category: "funny" },
  { quote: "Weeks of coding can save you hours of planning.", author: "Anonymous", category: "funny" },
  { quote: "Nine people cannot make a baby in a month.", author: "Fred Brooks", category: "funny" },
  { quote: "Software development is 10% writing code and 90% figuring out why the story was estimated at 2 points instead of 8.", author: "Unknown", category: "funny" },
  { quote: "A story point is a unit of measurement used to quantify the amount of anxiety a ticket will induce.", author: "Dev Twitter", category: "funny" },
  { quote: "The only thing more inaccurate than a weather forecast is a software estimate.", author: "Classic Dev Proverb", category: "funny" },
];

export function pickRandomQuote(): Quote {
  return planningQuotes[Math.floor(Math.random() * planningQuotes.length)]!;
}