const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const readline = require('readline');
const { exec } = require('child_process');
const os = require('os');
require('dotenv').config();

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// CONFIGURATION
const config = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    models: [
      'meta-llama/llama-3.2-3b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
      'microsoft/wizardlm-2-8x22b:free',
      'google/gemini-flash-1.5:free'
    ]
  },
  app: {
    maxSearchResults: 25,
    requestDelayMs: 2000, // Increased delay to avoid rate limiting
    timeout: 20000
  }
};

// HELPER FUNCTIONS
class Helpers {
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static log(message, level = 'info') {
    const levels = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      success: '✅',
      search: '🔍',
      ai: '🤖'
    };
    const emoji = levels[level] || '📝';
    console.log(`${emoji} ${message}`);
  }

  static validatePrompt(prompt) {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt cannot be empty');
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
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  static openInBrowser(filePath) {
    return new Promise((resolve, reject) => {
      const platform = os.platform();
      let command;

      switch (platform) {
        case 'win32':
          command = `start "" "${filePath}"`;
          break;
        case 'darwin':
          command = `open "${filePath}"`;
          break;
        case 'linux':
          command = `xdg-open "${filePath}"`;
          break;
        default:
          reject(new Error(`Unsupported platform: ${platform}`));
          return;
      }

      exec(command, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

// ROBUST SEARCH SERVICE WITH WORKING FREE ENGINES
class SearchService {
  constructor() {
    this.cache = new Map();
  }

  async enhancedSearch(query, maxResults = 25) {
    Helpers.log(`Launching comprehensive search: "${query}"`, 'search');
    
    const allResults = {
      summary: '',
      sources: [],
      searchEnginesUsed: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Use only reliable free search methods
      const searchMethods = [
        this.searchDuckDuckGo(query, 10),
        this.searchBing(query, 8),
        this.searchWikipedia(query, 5),
        this.searchReddit(query, 5),
        this.searchYouTube(query, 5),
        this.searchNewsAPI(query, 5)
      ];

      const results = await Promise.allSettled(searchMethods);
      
      // Aggregate results
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value && result.value.sources) {
          allResults.sources.push(...result.value.sources);
          if (result.value.engine) {
            allResults.searchEnginesUsed.push(result.value.engine);
          }
          if (result.value.summary && !allResults.summary) {
            allResults.summary = result.value.summary;
          }
        }
      });

      // Process and deduplicate
      allResults.sources = this.deduplicateSources(allResults.sources).slice(0, maxResults);
      allResults.searchEnginesUsed = [...new Set(allResults.searchEnginesUsed)];

      Helpers.log(`✅ Search complete: ${allResults.sources.length} results from ${allResults.searchEnginesUsed.length} sources`, 'success');
      
    } catch (error) {
      Helpers.log(`❌ Search error: ${error.message}`, 'error');
    }

    return allResults;
  }

  // RELIABLE DUCKDUCKGO SEARCH
  async searchDuckDuckGo(query, maxResults) {
    try {
      Helpers.log('Searching DuckDuckGo...', 'search');
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, { 
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
      });
      
      const $ = cheerio.load(response.data);
      const sources = [];

      // Parse search results
      $('.result').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('.result__title').text().trim();
        const content = $(element).find('.result__snippet').text().trim();
        const url = $(element).find('.result__url').attr('href');

        if (title && content) {
          sources.push({
            type: 'web',
            title: title,
            content: content,
            url: url ? `https://${url}` : '',
            source: 'DuckDuckGo',
            icon: '🌐',
            relevance: 9 - (index * 0.1)
          });
        }
      });

      return { 
        sources, 
        engine: 'DuckDuckGo',
        summary: `Found ${sources.length} results from DuckDuckGo`
      };
    } catch (error) {
      Helpers.log(`❌ DuckDuckGo search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'DuckDuckGo' };
    }
  }

  // RELIABLE BING SEARCH
  async searchBing(query, maxResults) {
    try {
      Helpers.log('Searching Bing...', 'search');
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
      const response = await axios.get(searchUrl, {
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
      });

      const $ = cheerio.load(response.data);
      const sources = [];

      $('.b_algo').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('h2').first().text();
        const content = $(element).find('.b_caption p').first().text() || $(element).find('.b_attribution').text();
        const url = $(element).find('h2 a').first().attr('href');

        if (title && content && url) {
          sources.push({
            type: 'web',
            title: title,
            content: content,
            url: url,
            source: 'Bing',
            icon: '🔎',
            relevance: 8 - (index * 0.1)
          });
        }
      });

      return { 
        sources, 
        engine: 'Bing',
        summary: `Found ${sources.length} results from Bing`
      };
    } catch (error) {
      Helpers.log(`❌ Bing search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'Bing' };
    }
  }

  // WIKIPEDIA SEARCH
  async searchWikipedia(query, maxResults) {
    try {
      Helpers.log('Searching Wikipedia...', 'search');
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}`;
      const response = await axios.get(searchUrl, { 
        timeout: config.app.timeout,
        headers: { 'User-Agent': Helpers.generateUserAgent() }
      });

      const sources = [];
      if (response.data.query?.search) {
        response.data.query.search.forEach((article, index) => {
          sources.push({
            type: 'encyclopedia',
            title: article.title,
            content: article.snippet + '...',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
            source: 'Wikipedia',
            icon: '📚',
            relevance: 10 - (index * 0.2)
          });
        });
      }

      return { 
        sources, 
        engine: 'Wikipedia',
        summary: `Found ${sources.length} Wikipedia articles`
      };
    } catch (error) {
      Helpers.log(`❌ Wikipedia search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'Wikipedia' };
    }
  }

  // REDDIT SEARCH
  async searchReddit(query, maxResults) {
    try {
      Helpers.log('Searching Reddit...', 'search');
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&sort=relevance`;
      const response = await axios.get(searchUrl, {
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'application/json'
        }
      });

      const sources = [];
      if (response.data.data?.children) {
        response.data.data.children.forEach((post, index) => {
          const postData = post.data;
          if (postData.title) {
            sources.push({
              type: 'discussion',
              title: postData.title,
              content: postData.selftext?.substring(0, 200) + '...' || `Discussion in ${postData.subreddit_name_prefixed}`,
              url: `https://reddit.com${postData.permalink}`,
              source: 'Reddit',
              icon: '💬',
              subreddit: postData.subreddit_name_prefixed,
              upvotes: postData.score,
              relevance: 7 - (index * 0.2)
            });
          }
        });
      }

      return { 
        sources, 
        engine: 'Reddit',
        summary: `Found ${sources.length} Reddit discussions`
      };
    } catch (error) {
      Helpers.log(`❌ Reddit search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'Reddit' };
    }
  }

  // YOUTUBE SEARCH
  async searchYouTube(query, maxResults) {
    try {
      Helpers.log('Searching YouTube...', 'search');
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const response = await axios.get(searchUrl, {
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
      });

      const $ = cheerio.load(response.data);
      const sources = [];

      $('ytd-video-renderer').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('#video-title').first().text().trim();
        const channel = $(element).find('.ytd-channel-name a').first().text().trim();
        const url = $(element).find('#video-title').first().attr('href');

        if (title && url) {
          const fullUrl = url.startsWith('/') ? `https://www.youtube.com${url}` : url;
          sources.push({
            type: 'video',
            title: title,
            content: `Channel: ${channel}`,
            url: fullUrl,
            source: 'YouTube',
            icon: '🎬',
            channel: channel,
            relevance: 8 - (index * 0.2)
          });
        }
      });

      return { 
        sources, 
        engine: 'YouTube',
        summary: `Found ${sources.length} YouTube videos`
      };
    } catch (error) {
      Helpers.log(`❌ YouTube search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'YouTube' };
    }
  }

  // NEWS API (Using free news aggregation)
  async searchNewsAPI(query, maxResults) {
    try {
      Helpers.log('Searching news sources...', 'search');
      
      // Use DuckDuckGo news search as fallback
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' news')}`;
      const response = await axios.get(searchUrl, {
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml'
        }
      });

      const $ = cheerio.load(response.data);
      const sources = [];

      $('.result').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('.result__title').text().trim();
        const content = $(element).find('.result__snippet').text().trim();
        const url = $(element).find('.result__url').attr('href');

        if (title && content && url && (content.toLowerCase().includes('news') || title.toLowerCase().includes('news'))) {
          sources.push({
            type: 'news',
            title: title,
            content: content,
            url: url ? `https://${url}` : '',
            source: 'News',
            icon: '📰',
            relevance: 9 - (index * 0.1)
          });
        }
      });

      return { 
        sources, 
        engine: 'News',
        summary: `Found ${sources.length} news articles`
      };
    } catch (error) {
      Helpers.log(`❌ News search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'News' };
    }
  }

  deduplicateSources(sources) {
    const seen = new Set();
    return sources
      .filter(source => {
        const key = source.title + source.url;
        if (seen.has(key) || !source.content || source.content.length < 10) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.relevance - a.relevance);
  }
}

// AI SERVICE
class AIService {
  constructor() {
    this.successfulModels = new Set();
  }

  async getAIResponse(prompt, searchResults) {
    Helpers.log('Analyzing search results with AI...', 'ai');
    
    for (const model of config.openrouter.models) {
      try {
        const response = await this.callAI(model, prompt, searchResults);
        this.successfulModels.add(model);
        Helpers.log(`✅ Analysis complete using ${model}`, 'success');
        return response;
      } catch (error) {
        Helpers.log(`❌ ${model} failed: ${error.message}`, 'error');
        await Helpers.delay(1000);
      }
    }

    Helpers.log('❌ All AI models failed, using fallback', 'error');
    return this.getFallbackResponse(prompt, searchResults);
  }

  async callAI(model, prompt, searchResults) {
    const fullPrompt = this.buildPrompt(prompt, searchResults);

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: model,
      messages: [
        {
          role: "system",
          content: "You are a comprehensive research assistant. Provide detailed, well-structured analysis with specific references. Focus on accuracy and relevance."
        },
        {
          role: "user",
          content: fullPrompt
        }
      ],
      max_tokens: 2000,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${config.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com',
        'X-Title': 'Web Search AI'
      },
      timeout: 30000
    });

    return {
      content: response.data.choices[0].message.content,
      model: model
    };
  }

  buildPrompt(userPrompt, searchResults) {
    let context = `RESEARCH REQUEST: "${userPrompt}"\n\n`;
    context += `SEARCH RESULTS (${searchResults.sources.length} sources):\n\n`;

    searchResults.sources.forEach((source, index) => {
      context += `[${index + 1}] ${source.icon} ${source.source}: ${source.title}\n`;
      context += `Content: ${source.content}\n`;
      if (source.url) context += `URL: ${source.url}\n`;
      context += `Relevance: ${source.relevance}/10\n\n`;
    });

    return `${context}\nQUESTION: ${userPrompt}\n\nPlease provide a comprehensive analysis:`;
  }

  getFallbackResponse(prompt, searchResults) {
    let response = `# Analysis: ${prompt}\n\n`;
    
    if (searchResults.sources.length > 0) {
      response += `## Search Summary\nFound ${searchResults.sources.length} relevant sources.\n\n`;
      response += `## Key Information\n\n`;
      
      searchResults.sources.slice(0, 8).forEach((source, index) => {
        response += `### ${source.icon} ${source.title}\n`;
        response += `${source.content}\n`;
        response += `*Source: ${source.source}*\n\n`;
      });
    } else {
      response += `No relevant information found for "${prompt}".\n`;
    }

    return {
      content: response,
      model: 'fallback'
    };
  }
}

// FILE SERVICE WITH CHROME-LIKE UI
class FileService {
  constructor() {
    this.outputDir = path.join(process.cwd(), 'outputs');
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async saveResult(result) {
    if (!result.success) return null;

    try {
      const timestamp = Date.now();
      const htmlFilename = `search-result-${timestamp}.html`;
      const htmlPath = path.join(this.outputDir, htmlFilename);
      
      const htmlContent = this.generateChromeLikeHTML(result);
      fs.writeFileSync(htmlPath, htmlContent);

      Helpers.log(`✅ Result saved: ${htmlFilename}`, 'success');
      return { htmlPath, filename: htmlFilename };
    } catch (error) {
      Helpers.log(`❌ Save failed: ${error.message}`, 'error');
      return null;
    }
  }

  generateChromeLikeHTML(result) {
    const sources = result.searchResults.sources;
    const networks = result.searchResults.searchEnginesUsed;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Search Results: ${Helpers.escapeHtml(result.prompt)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8f9fa;
            color: #202124;
            line-height: 1.6;
        }
        
        .header {
            background: #1a73e8;
            color: white;
            padding: 20px 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .search-query {
            font-size: 1.4em;
            font-weight: 400;
            margin-bottom: 8px;
        }
        
        .search-stats {
            display: flex;
            gap: 20px;
            font-size: 0.9em;
            opacity: 0.9;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .ai-section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            border: 1px solid #e8eaed;
        }
        
        .section-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.3em;
            font-weight: 500;
            color: #1a73e8;
            margin-bottom: 20px;
        }
        
        .ai-content {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            border-left: 4px solid #1a73e8;
            white-space: pre-line;
            line-height: 1.7;
        }
        
        .results-section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            border: 1px solid #e8eaed;
        }
        
        .result-item {
            padding: 20px 0;
            border-bottom: 1px solid #e8eaed;
        }
        
        .result-item:last-child {
            border-bottom: none;
        }
        
        .result-title {
            font-size: 1.2em;
            font-weight: 500;
            color: #1a0dab;
            text-decoration: none;
            display: block;
            margin-bottom: 8px;
            cursor: pointer;
        }
        
        .result-title:hover {
            text-decoration: underline;
        }
        
        .result-url {
            color: #006621;
            font-size: 0.85em;
            font-family: monospace;
            margin-bottom: 8px;
            display: block;
        }
        
        .result-content {
            color: #4d5156;
            margin-bottom: 8px;
            line-height: 1.5;
        }
        
        .result-meta {
            display: flex;
            gap: 15px;
            align-items: center;
            font-size: 0.8em;
            color: #70757a;
        }
        
        .source-badge {
            background: #e8f0fe;
            color: #1a73e8;
            padding: 2px 8px;
            border-radius: 12px;
            font-weight: 500;
        }
        
        .type-badge {
            background: #f1f3f4;
            color: #5f6368;
            padding: 2px 8px;
            border-radius: 12px;
        }
        
        .networks-section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-top: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            border: 1px solid #e8eaed;
        }
        
        .networks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-top: 15px;
        }
        
        .network-item {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 8px;
            text-align: center;
            font-size: 0.9em;
        }
        
        .footer {
            text-align: center;
            padding: 30px;
            color: #70757a;
            font-size: 0.9em;
            margin-top: 40px;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 15px;
            }
            
            .header {
                padding: 15px 20px;
            }
            
            .search-stats {
                flex-direction: column;
                gap: 5px;
            }
            
            .networks-grid {
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <div class="search-query">${Helpers.escapeHtml(result.prompt)}</div>
            <div class="search-stats">
                <span>${sources.length} results</span>
                <span>${networks.length} search sources</span>
                <span>AI Model: ${result.model}</span>
            </div>
        </div>
    </div>
    
    <div class="container">
        <div class="ai-section">
            <div class="section-title">
                <span>🤖</span>
                <span>AI Analysis</span>
            </div>
            <div class="ai-content">${Helpers.escapeHtml(result.answer)}</div>
        </div>
        
        <div class="results-section">
            <div class="section-title">
                <span>🔍</span>
                <span>Search Results (${sources.length})</span>
            </div>
            
            ${sources.map((source, index) => `
            <div class="result-item">
                <a href="${source.url}" target="_blank" class="result-title">
                    ${source.icon} ${Helpers.escapeHtml(source.title)}
                </a>
                ${source.url ? `<a href="${source.url}" target="_blank" class="result-url">${source.url}</a>` : ''}
                <div class="result-content">${Helpers.escapeHtml(source.content)}</div>
                <div class="result-meta">
                    <span class="source-badge">${source.source}</span>
                    <span class="type-badge">${source.type}</span>
                    <span>Relevance: ${source.relevance}/10</span>
                    ${source.upvotes ? `<span>▲ ${source.upvotes}</span>` : ''}
                </div>
            </div>
            `).join('')}
        </div>
        
        <div class="networks-section">
            <div class="section-title">
                <span>🌐</span>
                <span>Search Sources Used</span>
            </div>
            <div class="networks-grid">
                ${networks.map(network => `
                <div class="network-item">${network}</div>
                `).join('')}
            </div>
        </div>
    </div>
    
    <div class="footer">
        <p>Generated by Web Search AI • ${new Date().toLocaleDateString()}</p>
        <p style="margin-top: 10px; opacity: 0.7;">
            All search results open in new tabs • Comprehensive multi-source search
        </p>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const links = document.querySelectorAll('.result-title');
            links.forEach(link => {
                link.addEventListener('click', function() {
                    this.style.opacity = '0.7';
                    setTimeout(() => {
                        this.style.opacity = '1';
                    }, 150);
                });
            });
        });
    </script>
</body>
</html>`;
  }
}

// MAIN APPLICATION
class WebSearchAI {
  constructor() {
    this.searchService = new SearchService();
    this.aiService = new AIService();
    this.fileService = new FileService();
    this.results = [];
  }

  async processQuery(prompt) {
    try {
      Helpers.log(`Starting comprehensive search for: "${prompt}"`, 'info');
      
      // Enhanced search with reliable methods
      const searchResults = await this.searchService.enhancedSearch(prompt);
      
      // AI analysis
      const aiResponse = await this.aiService.getAIResponse(prompt, searchResults);
      
      const result = {
        success: true,
        prompt: prompt,
        answer: aiResponse.content,
        model: aiResponse.model,
        searchResults: searchResults,
        timestamp: new Date().toISOString()
      };

      // Save result
      const saveInfo = await this.fileService.saveResult(result);
      if (saveInfo) {
        result.filename = saveInfo.filename;
        result.filePath = saveInfo.htmlPath;
      }

      this.results.push(result);
      Helpers.log(`✅ Search and analysis completed successfully!`, 'success');
      return result;

    } catch (error) {
      Helpers.log(`❌ Processing failed: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message,
        prompt: prompt
      };
    }
  }

  getStats() {
    const successful = this.results.filter(r => r.success);
    return {
      total: this.results.length,
      successful: successful.length,
      failed: this.results.length - successful.length,
      models: [...this.aiService.successfulModels]
    };
  }
}

// SIMPLIFIED INTERACTIVE CLI
async function main() {
  console.log('\n🚀 Web Search AI - Reliable Search Assistant');
  console.log('============================================\n');
  console.log('🌐 Features:');
  console.log('• Reliable Free Search Engines');
  console.log('• Chrome-like Visual Interface');
  console.log('• AI-Powered Analysis');
  console.log('• Professional HTML Reports\n');
  
  const assistant = new WebSearchAI();
  
  while (true) {
    console.log('\n📋 Menu Options:');
    console.log('1. Search Query');
    console.log('2. Example Search');
    console.log('3. View Statistics');
    console.log('4. Exit');
    
    const choice = await Helpers.askQuestion('\nSelect option (1-4): ');
    
    switch (choice) {
      case '1':
        await handleSearch(assistant);
        break;
      case '2':
        await handleExampleSearch(assistant);
        break;
      case '3':
        showStatistics(assistant);
        break;
      case '4':
        console.log('\n👋 Thank you for using Web Search AI!');
        rl.close();
        return;
      default:
        console.log('❌ Please select a valid option (1-4)');
    }
  }
}

async function handleSearch(assistant) {
  const query = await Helpers.askQuestion('\n🔍 Enter your search query: ');
  if (query.trim()) {
    const result = await assistant.processQuery(query.trim());
    displayResult(result);
  } else {
    console.log('❌ Please enter a valid query');
  }
}

async function handleExampleSearch(assistant) {
  const examples = [
    "basketball history and rules",
    "artificial intelligence applications",
    "renewable energy sources",
    "space exploration achievements",
    "healthy eating habits"
  ];
  
  const query = examples[Math.floor(Math.random() * examples.length)];
  console.log(`\n🎲 Using example: "${query}"`);
  
  const result = await assistant.processQuery(query);
  displayResult(result);
}

function showStatistics(assistant) {
  const stats = assistant.getStats();
  console.log('\n📊 Search Statistics:');
  console.log(`Total Searches: ${stats.total}`);
  console.log(`Successful: ${stats.successful}`);
  console.log(`Failed: ${stats.failed}`);
  console.log(`Working AI Models: ${stats.models.join(', ') || 'None'}`);
}

function displayResult(result) {
  if (result.success) {
    console.log('\n✅ SEARCH COMPLETED SUCCESSFULLY!');
    console.log(`📁 File: ${result.filename}`);
    console.log(`🤖 AI Model: ${result.model}`);
    console.log(`🔍 Sources: ${result.searchResults.sources.length}`);
    console.log(`🌐 Networks: ${result.searchResults.searchEnginesUsed.length}`);
    
    if (result.filePath) {
      console.log('\n🚀 Opening results in browser...');
      Helpers.openInBrowser(result.filePath)
        .then(() => console.log('✅ Browser opened successfully!'))
        .catch(err => console.log('❌ Could not open browser:', err.message));
    }
  } else {
    console.log('\n❌ SEARCH FAILED:');
    console.log(`Error: ${result.error}`);
  }
}

// Start application
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    rl.close();
    process.exit(1);
  });
}

module.exports = WebSearchAI;