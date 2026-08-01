const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const readline = require('readline');
const { exec } = require('child_process');
const os = require('os');
require('dotenv').config();

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// CONFIGURATION
const config = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
      'microsoft/wizardlm-2-8x22b:free',
      'google/gemini-flash-1.5:free'
    ]
  },
  app: {
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS) || 15,
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS) || 3000
  }
};

// HELPER FUNCTIONS
class Helpers {
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static truncateText(text, maxLength = 500) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  static log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const levels = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      success: '✅',
      debug: '🐛'
    };
    const emoji = levels[level] || '📝';
    console.log(`${emoji} [${timestamp}] ${message}`);
  }

  static validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt must be a non-empty string');
    }
    if (prompt.length > 1000) {
      throw new Error('Prompt must be less than 1000 characters');
    }
    return prompt.trim();
  }

  static escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
      .replace(/\n/g, '<br>');
  }

  static askQuestion(question) {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  }

  static generateUserAgent() {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  static openInBrowser(filePath) {
    return new Promise((resolve, reject) => {
      const platform = os.platform();
      let command;

      switch (platform) {
        case 'win32': // Windows
          command = `start "" "${filePath}"`;
          break;
        case 'darwin': // macOS
          command = `open "${filePath}"`;
          break;
        case 'linux': // Linux
          command = `xdg-open "${filePath}"`;
          break;
        default:
          reject(new Error(`Unsupported platform: ${platform}`));
          return;
      }

      exec(command, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

// SEARCH SERVICE
class SearchService {
  async searchWeb(query, maxResults = 15) {
    Helpers.log(`🔍 Searching web for: "${query}"`, 'info');
    
    const allResults = {
      summary: '',
      sources: [],
      rawData: {},
      searchEnginesUsed: []
    };

    try {
      const searchPromises = [
        this.searchDuckDuckGo(query, maxResults),
        this.searchDirectScrape(query, maxResults)
      ];

      const results = await Promise.allSettled(searchPromises);
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.sources.length > 0) {
          allResults.sources.push(...result.value.sources);
          allResults.searchEnginesUsed.push(result.value.engine);
          
          if (result.value.summary && !allResults.summary) {
            allResults.summary = result.value.summary;
          }
        }
      }

      allResults.sources = this.removeDuplicateSources(allResults.sources).slice(0, maxResults);
      
      Helpers.log(`✅ Found ${allResults.sources.length} sources from: ${allResults.searchEnginesUsed.join(', ')}`, 'success');
      
    } catch (error) {
      Helpers.log(`❌ Search error: ${error.message}`, 'error');
    }

    return allResults;
  }

  async searchDuckDuckGo(query, maxResults) {
    try {
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await axios.get(searchUrl, { 
        timeout: 20000,
        headers: {
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'application/json'
        }
      });
      
      const data = response.data;
      const results = {
        engine: 'duckduckgo',
        summary: data.AbstractText || '',
        sources: []
      };

      if (data.RelatedTopics) {
        data.RelatedTopics.slice(0, maxResults).forEach((topic, index) => {
          if (topic.Text && topic.Text.length > 10) {
            results.sources.push({
              type: 'related',
              title: this.extractTitle(topic.Text),
              content: topic.Text,
              url: topic.FirstURL || '',
              rank: index + 1,
              engine: 'duckduckgo'
            });
          }
        });
      }

      if (data.Results) {
        data.Results.slice(0, maxResults).forEach((result, index) => {
          if (result.Text && result.Text.length > 10) {
            results.sources.push({
              type: 'result',
              title: this.extractTitle(result.Text),
              content: result.Text,
              url: result.FirstURL,
              rank: index + 1,
              engine: 'duckduckgo'
            });
          }
        });
      }

      if (data.AbstractText && data.AbstractText.length > 20) {
        results.sources.push({
          type: 'abstract',
          title: 'Summary',
          content: data.AbstractText,
          url: data.AbstractURL || '',
          rank: 0,
          engine: 'duckduckgo'
        });
      }

      return results;
    } catch (error) {
      Helpers.log(`❌ DuckDuckGo search failed: ${error.message}`, 'error');
      return { engine: 'duckduckgo', summary: '', sources: [] };
    }
  }

  async searchDirectScrape(query, maxResults) {
    try {
      const results = {
        engine: 'direct-scrape',
        summary: '',
        sources: []
      };

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl, {
        timeout: 25000,
        headers: {
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'DNT': '1',
          'Connection': 'keep-alive'
        }
      });

      const $ = cheerio.load(response.data);
      const sources = [];

      $('.result').slice(0, maxResults).each((index, element) => {
        if (sources.length >= maxResults) return false;

        let title = $(element).find('.result__title').text().trim();
        let content = $(element).find('.result__snippet').text().trim();
        let url = $(element).find('.result__url').text().trim() || 
                  $(element).find('a').first().attr('href') || '';

        if (url && url.startsWith('//')) {
          url = 'https:' + url;
        }

        if (title && content && title.length > 5 && content.length > 10) {
          sources.push({
            type: 'scraped',
            title: title,
            content: content,
            url: url,
            rank: sources.length + 1,
            engine: 'direct-scrape'
          });
        }
      });

      results.sources = sources;
      Helpers.log(`✅ Scraped ${sources.length} results from direct search`, 'success');
      return results;

    } catch (error) {
      Helpers.log(`❌ Direct scrape failed: ${error.message}`, 'error');
      return { engine: 'direct-scrape', summary: '', sources: [] };
    }
  }

  extractTitle(text) {
    if (text.length <= 60) return text;
    return text.substring(0, 57) + '...';
  }

  removeDuplicateSources(sources) {
    const seen = new Set();
    return sources.filter(source => {
      const key = (source.title + source.content).toLowerCase().replace(/\s+/g, ' ').substring(0, 100);
      if (seen.has(key) || source.content.length < 20) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  async enhancedSearch(query) {
    Helpers.log(`🚀 Enhanced search for: "${query}"`, 'info');
    
    const currentYear = new Date().getFullYear();
    const enhancedQuery = `${query} ${currentYear} latest news developments`;
    
    return await this.searchWeb(enhancedQuery, config.app.maxSearchResults);
  }
}

// AI SERVICE
class AIService {
  constructor() {
    this.currentModelIndex = 0;
    this.successfulModels = new Set();
  }

  async getAIResponse(prompt, searchResults, context = {}) {
    Helpers.log('🤖 Getting AI analysis...', 'info');
    
    for (let i = 0; i < config.openrouter.models.length; i++) {
      const model = config.openrouter.models[i];
      
      try {
        const fullPrompt = this.buildPrompt(prompt, searchResults, context);

        const requestBody = {
          model: model,
          messages: [
            {
              role: "system",
              content: "You are a helpful research assistant. Provide detailed, accurate answers based on the search results."
            },
            {
              role: "user",
              content: fullPrompt
            }
          ],
          max_tokens: 1500,
          temperature: 0.7
        };

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', requestBody, {
          headers: {
            'Authorization': 'Bearer ' + config.openrouter.apiKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com',
            'X-Title': 'Web Search AI'
          },
          timeout: 30000
        });

        if (response.data?.choices?.[0]?.message?.content) {
          const aiResponse = response.data.choices[0].message.content;
          
          Helpers.log(`✅ Success with model: ${model}`, 'success');
          this.successfulModels.add(model);
          this.currentModelIndex = i;
          
          return {
            content: aiResponse,
            model: model,
            endpoint: 'openrouter'
          };
        }
      } catch (error) {
        Helpers.log(`❌ Error with ${model}: ${error.response?.data?.error?.message || error.message}`, 'error');
      }
      
      if (i < config.openrouter.models.length - 1) {
        await Helpers.delay(2000);
      }
    }

    Helpers.log('❌ All models failed, using fallback response', 'error');
    return {
      content: this.getFallbackResponse(prompt, searchResults),
      model: 'fallback',
      endpoint: 'none'
    };
  }

  buildPrompt(userPrompt, searchResults, context = {}) {
    let searchContext = `SEARCH RESULTS FOR: "${userPrompt}"\n\n`;
    
    if (searchResults.sources.length > 0) {
      searchResults.sources.forEach((source, index) => {
        searchContext += `SOURCE ${index + 1}:\n`;
        searchContext += `Title: ${source.title || 'No title'}\n`;
        searchContext += `Content: ${source.content}\n`;
        if (source.url) searchContext += `URL: ${source.url}\n`;
        searchContext += `---\n\n`;
      });
    } else {
      searchContext += "No specific search results found.\n\n";
    }

    return `Please analyze the following search results and provide a comprehensive answer.

${searchContext}

QUESTION: ${userPrompt}

Please provide a helpful, detailed answer based on the search results above:`;
  }

  getFallbackResponse(prompt, searchResults) {
    let response = `Based on my analysis:\n\n`;
    
    if (searchResults.sources.length > 0) {
      response += `I found ${searchResults.sources.length} sources:\n\n`;
      searchResults.sources.forEach((source, index) => {
        response += `${index + 1}. ${source.content}\n\n`;
      });
    } else {
      response += `No specific information was found in the search results for "${prompt}".\n\n`;
    }
    
    response += `For the most current information, I recommend checking official sources and recent publications.`;
    
    return response;
  }

  getSuccessfulModels() {
    return Array.from(this.successfulModels);
  }
}

// FILE SERVICE
class FileService {
  constructor() {
    this.outputDir = path.join(process.cwd(), 'outputs');
    this.successfulResults = [];
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      Helpers.log('Created outputs directory', 'success');
    }
  }

  async saveSuccessfulResult(result) {
    if (!result.success) {
      Helpers.log(`❌ Skipping failed result: ${result.prompt}`, 'error');
      return null;
    }

    try {
      const timestamp = new Date().toISOString();
      
      // Save JSON file
      const jsonFilename = `result-${Date.now()}.json`;
      const jsonFilePath = path.join(this.outputDir, jsonFilename);
      
      const resultData = {
        timestamp: timestamp,
        prompt: result.prompt,
        answer: result.answer,
        searchResults: result.searchResults,
        modelUsed: result.model,
        sourcesCount: result.searchResults.sources.length,
        searchEngines: result.searchResults.searchEnginesUsed
      };

      fs.writeFileSync(jsonFilePath, JSON.stringify(resultData, null, 2));
      
      // Save HTML file
      const htmlFilename = `result-${Date.now()}.html`;
      const htmlFilePath = path.join(this.outputDir, htmlFilename);
      const htmlContent = this.generateHTML(result);
      
      fs.writeFileSync(htmlFilePath, htmlContent);
      
      this.successfulResults.push(result);
      
      Helpers.log(`✅ Result saved to: ${htmlFilename}`, 'success');
      
      return {
        success: true,
        jsonFile: jsonFilename,
        htmlFile: htmlFilename,
        htmlPath: htmlFilePath
      };

    } catch (error) {
      Helpers.log(`Error saving result: ${error.message}`, 'error');
      return null;
    }
  }

  generateHTML(results) {
    const sourcesCount = results.searchResults?.sources?.length || 0;
    const enginesUsed = results.searchResults?.searchEnginesUsed?.join(', ') || 'N/A';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Search: ${Helpers.escapeHtml(results.prompt)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            background: #f8f9fa; 
            color: #202124; 
            line-height: 1.6; 
            padding: 20px;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
            overflow: hidden;
        }
        .header { 
            background: #1a73e8; 
            color: white; 
            padding: 30px; 
            text-align: center; 
        }
        .header h1 { 
            font-size: 2em; 
            margin-bottom: 10px; 
        }
        .stats { 
            display: flex; 
            gap: 20px; 
            padding: 20px; 
            background: #f1f3f4;
            flex-wrap: wrap;
        }
        .stat { 
            background: white; 
            padding: 10px 15px; 
            border-radius: 8px; 
            font-size: 14px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .content { 
            padding: 30px; 
        }
        .section { 
            margin-bottom: 30px; 
            padding: 25px; 
            background: #f8f9fa; 
            border-radius: 8px; 
            border-left: 4px solid #1a73e8;
        }
        .section h2 { 
            color: #1a73e8; 
            margin-bottom: 15px; 
            font-size: 1.4em;
        }
        .ai-answer { 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            white-space: pre-line; 
            line-height: 1.7;
            border: 1px solid #e8eaed;
        }
        .source-item { 
            background: white; 
            padding: 20px; 
            margin: 15px 0; 
            border-radius: 8px; 
            border: 1px solid #e8eaed;
        }
        .source-title { 
            font-weight: bold; 
            color: #1a0dab; 
            margin-bottom: 8px; 
            font-size: 1.1em;
        }
        .source-content { 
            color: #4d5156; 
            margin-bottom: 8px; 
            line-height: 1.5;
        }
        .source-url { 
            color: #006621; 
            font-size: 0.9em; 
            font-family: monospace;
        }
        .source-meta { 
            display: flex; 
            gap: 10px; 
            margin-top: 10px; 
            font-size: 0.8em; 
            color: #5f6368;
        }
        .meta-tag { 
            background: #e8eaed; 
            padding: 2px 8px; 
            border-radius: 4px;
        }
        .footer { 
            text-align: center; 
            padding: 20px; 
            background: #f1f3f4; 
            color: #5f6368; 
            font-size: 0.9em;
        }
        @media (max-width: 768px) {
            .content { padding: 15px; }
            .section { padding: 15px; }
            .stats { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 AI Search Results</h1>
            <p>${Helpers.escapeHtml(results.prompt)}</p>
        </div>
        
        <div class="stats">
            <div class="stat">🤖 Model: ${results.model || 'N/A'}</div>
            <div class="stat">🔍 Sources: ${sourcesCount}</div>
            <div class="stat">🌐 Engines: ${enginesUsed}</div>
            <div class="stat">⏰ ${new Date().toLocaleString()}</div>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>AI Analysis</h2>
                <div class="ai-answer">${Helpers.escapeHtml(results.answer || 'No analysis available.')}</div>
            </div>
            
            <div class="section">
                <h2>Web Sources (${sourcesCount})</h2>
                ${sourcesCount > 0 ? 
                  results.searchResults.sources.map((source, index) => `
                    <div class="source-item">
                        <div class="source-title">${index + 1}. ${Helpers.escapeHtml(source.title || `Source ${index + 1}`)}</div>
                        <div class="source-content">${Helpers.escapeHtml(source.content || 'No content available.')}</div>
                        ${source.url ? `<div class="source-url">${source.url}</div>` : ''}
                        <div class="source-meta">
                            <span class="meta-tag">${source.type || 'unknown'}</span>
                            <span class="meta-tag">${source.engine || 'unknown'}</span>
                            <span class="meta-tag">Rank: ${source.rank || index + 1}</span>
                        </div>
                    </div>
                  `).join('') : 
                  '<div class="source-item"><div class="source-content">No web sources found for this query.</div></div>'
                }
            </div>
        </div>
        
        <div class="footer">
            Generated by Web Search AI Assistant • ${new Date().getFullYear()}
        </div>
    </div>
</body>
</html>`;
  }

  getSuccessfulResults() {
    return this.successfulResults;
  }
}

// MAIN AI ASSISTANT
class WebSearchAIAssistant {
  constructor() {
    this.searchService = new SearchService();
    this.aiService = new AIService();
    this.fileService = new FileService();
  }

  async processPrompt(prompt, options = {}) {
    try {
      Helpers.log(`🚀 Processing: "${prompt}"`, 'info');
      
      const validatedPrompt = Helpers.validatePrompt(prompt);
      
      Helpers.log('🔍 Searching web...', 'info');
      const searchResults = await this.searchService.enhancedSearch(validatedPrompt);
      
      Helpers.log('🤖 Getting AI analysis...', 'info');
      const aiResponse = await this.aiService.getAIResponse(validatedPrompt, searchResults, options);
      
      const result = {
        success: true,
        prompt: validatedPrompt,
        answer: aiResponse.content,
        model: aiResponse.model,
        endpoint: aiResponse.endpoint,
        searchResults: searchResults,
        timestamp: new Date().toISOString()
      };

      const saveResult = await this.fileService.saveSuccessfulResult(result);
      
      if (saveResult) {
        result.filename = saveResult.htmlFile;
        result.filePath = saveResult.htmlPath;
        result.savedToFile = saveResult.success;
      }

      Helpers.log(`✅ Processing completed with model: ${aiResponse.model}`, 'success');
      return result;

    } catch (error) {
      Helpers.log(`❌ Error processing prompt: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message,
        prompt: prompt
      };
    }
  }

  async processMultiplePrompts(prompts, options = {}) {
    Helpers.log(`Processing ${prompts.length} prompts...`, 'info');
    const results = [];
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      Helpers.log(`[${i + 1}/${prompts.length}] Processing: ${Helpers.truncateText(prompt, 50)}`, 'info');
      
      const result = await this.processPrompt(prompt, options);
      results.push(result);
      
      if (i < prompts.length - 1) {
        await Helpers.delay(config.app.requestDelayMs);
      }
    }

    return results;
  }

  getSuccessfulModels() {
    return this.aiService.getSuccessfulModels();
  }

  getSuccessfulResults() {
    return this.fileService.getSuccessfulResults();
  }
}

// INTERACTIVE APPLICATION
async function main() {
  console.log('🚀 Web Search AI Assistant');
  console.log('==========================\n');
  
  const assistant = new WebSearchAIAssistant();
  
  while (true) {
    console.log('\nChoose an option:');
    console.log('1. Enter a single search query');
    console.log('2. Enter multiple search queries');
    console.log('3. Use example queries');
    console.log('4. View successful results');
    console.log('5. Exit');
    
    const choice = await Helpers.askQuestion('\nEnter your choice (1-5): ');
    
    switch (choice) {
      case '1':
        await handleSingleQuery(assistant);
        break;
      case '2':
        await handleMultipleQueries(assistant);
        break;
      case '3':
        await handleExampleQueries(assistant);
        break;
      case '4':
        await viewSuccessfulResults(assistant);
        break;
      case '5':
        console.log('👋 Thank you for using Web Search AI Assistant!');
        rl.close();
        return;
      default:
        console.log('❌ Invalid choice. Please try again.');
    }
  }
}

async function handleSingleQuery(assistant) {
  const query = await Helpers.askQuestion('\n🔍 Enter your search query: ');
  
  if (query.trim()) {
    console.log('\n🔄 Processing your query...');
    const results = await assistant.processMultiplePrompts([query]);
    displayResults(results, assistant);
  } else {
    console.log('❌ Please enter a valid query.');
  }
}

async function handleMultipleQueries(assistant) {
  const input = await Helpers.askQuestion('\n🔍 Enter multiple queries separated by "|": ');
  
  if (input.trim()) {
    const queries = input.split('|').map(q => q.trim()).filter(q => q);
    console.log(`\n🔄 Processing ${queries.length} queries...`);
    const results = await assistant.processMultiplePrompts(queries);
    displayResults(results, assistant);
  } else {
    console.log('❌ Please enter valid queries.');
  }
}

async function handleExampleQueries(assistant) {
  const examples = [
    "flying cars in 2025",
    "artificial intelligence in healthcare",
    "renewable energy trends",
    "space exploration updates"
  ];
  
  console.log('\n📋 Using example queries:');
  examples.forEach((example, index) => {
    console.log(`${index + 1}. ${example}`);
  });
  
  console.log('\n🔄 Processing examples...');
  const results = await assistant.processMultiplePrompts(examples);
  displayResults(results, assistant);
}

async function viewSuccessfulResults(assistant) {
  const successfulResults = assistant.getSuccessfulResults();
  
  if (successfulResults.length === 0) {
    console.log('\n❌ No successful results yet. Run some queries first!');
    return;
  }
  
  console.log(`\n✅ You have ${successfulResults.length} successful results:`);
  successfulResults.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.prompt}`);
    console.log(`   Model: ${result.model}`);
    console.log(`   File: ${result.filename}`);
    console.log(`   Sources: ${result.searchResults.sources.length}`);
  });
}

function displayResults(results, assistant) {
  console.log('\n📊 RESULTS SUMMARY:');
  console.log('===================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    console.log('\n🎯 Successful queries:');
    successful.forEach((result, index) => {
      console.log(`${index + 1}. ${result.prompt}`);
      console.log(`   Model: ${result.model} | Sources: ${result.searchResults.sources.length} | File: ${result.filename}`);
      
      // Automatically open the HTML file in browser
      if (result.filePath) {
        console.log(`   🚀 Opening in browser...`);
        Helpers.openInBrowser(result.filePath)
          .then(() => console.log(`   ✅ Opened: ${result.filename}`))
          .catch(err => console.log(`   ❌ Could not open browser: ${err.message}`));
      }
    });
  }
  
  if (failed.length > 0) {
    console.log('\n🚫 Failed queries:');
    failed.forEach((result, index) => {
      console.log(`${index + 1}. ${result.prompt}`);
      console.log(`   Error: ${result.error}`);
    });
  }
  
  const successfulModels = assistant.getSuccessfulModels();
  if (successfulModels.length > 0) {
    console.log(`\n🤖 Working models: ${successfulModels.join(', ')}`);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Application error:', error);
    rl.close();
    process.exit(1);
  });
}

module.exports = WebSearchAIAssistant;