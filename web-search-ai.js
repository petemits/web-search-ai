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

// ENHANCED SEARCH SERVICE
class SearchService {
  constructor() {
    this.searchEngines = ['duckduckgo', 'direct'];
  }

  async searchWeb(query, maxResults = 15) {
    Helpers.log(`🔍 Performing comprehensive web search for: "${query}"`, 'info');
    
    const allResults = {
      summary: '',
      sources: [],
      rawData: {},
      searchEnginesUsed: []
    };

    try {
      const searchPromises = [
        this.searchDuckDuckGoEnhanced(query, maxResults),
        this.searchDirectMultiple(query, maxResults)
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
      
      Helpers.log(`✅ Found ${allResults.sources.length} unique sources from: ${allResults.searchEnginesUsed.join(', ')}`, 'success');
      
    } catch (error) {
      Helpers.log(`❌ Search error: ${error.message}`, 'error');
    }

    return allResults;
  }

  async searchDuckDuckGoEnhanced(query, maxResults) {
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

      Helpers.log(`🦆 DuckDuckGo found ${results.sources.length} results`, 'info');
      return results;
    } catch (error) {
      Helpers.log(`❌ DuckDuckGo search failed: ${error.message}`, 'error');
      return { engine: 'duckduckgo', summary: '', sources: [] };
    }
  }

  async searchDirectMultiple(query, maxResults) {
    try {
      Helpers.log(`🌐 Starting direct web search for: "${query}"`, 'info');
      
      const results = {
        engine: 'direct-scrape',
        summary: '',
        sources: []
      };

      const searchSites = [
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
      ];

      for (const searchUrl of searchSites) {
        if (results.sources.length >= maxResults) break;
        
        try {
          const siteResults = await this.scrapeSearchResults(searchUrl, maxResults - results.sources.length);
          results.sources.push(...siteResults);
          Helpers.log(`✅ Scraped ${siteResults.length} results from ${new URL(searchUrl).hostname}`, 'success');
          await Helpers.delay(1000);
        } catch (error) {
          Helpers.log(`❌ Failed to scrape ${searchUrl}: ${error.message}`, 'warn');
        }
      }

      return results;
    } catch (error) {
      Helpers.log(`❌ Direct web search failed: ${error.message}`, 'error');
      return { engine: 'direct-scrape', summary: '', sources: [] };
    }
  }

  async scrapeSearchResults(searchUrl, maxResults) {
    try {
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

      const selectors = ['.result', '.web-result', '.result__body'];

      for (const selector of selectors) {
        $(selector).slice(0, maxResults).each((index, element) => {
          if (sources.length >= maxResults) return false;

          let title = $(element).find('.result__title, h2, h3').first().text().trim();
          let content = $(element).find('.result__snippet, .s').first().text().trim();
          let url = $(element).find('.result__url, .cite').first().text().trim() || 
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

        if (sources.length > 0) break;
      }

      return sources;
    } catch (error) {
      throw new Error(`Scraping failed: ${error.message}`);
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
    Helpers.log(`🚀 Performing enhanced comprehensive search for: "${query}"`, 'info');
    
    const currentYear = new Date().getFullYear();
    const enhancedQueries = [
      `${query} ${currentYear}`,
      `${query} latest news`,
      `${query} recent developments`
    ];

    const allResults = {
      summary: '',
      sources: [],
      rawData: {},
      searchEnginesUsed: []
    };

    for (const enhancedQuery of enhancedQueries) {
      if (allResults.sources.length >= config.app.maxSearchResults) break;
      
      Helpers.log(`🔍 Searching: "${enhancedQuery}"`, 'info');
      const results = await this.searchWeb(enhancedQuery, config.app.maxSearchResults - allResults.sources.length);
      
      allResults.sources.push(...results.sources);
      allResults.searchEnginesUsed.push(...results.searchEnginesUsed);
      
      if (results.summary && !allResults.summary) {
        allResults.summary = results.summary;
      }
      
      await Helpers.delay(2000);
    }

    allResults.sources = this.removeDuplicateSources(allResults.sources).slice(0, config.app.maxSearchResults);
    allResults.searchEnginesUsed = [...new Set(allResults.searchEnginesUsed)];
    
    Helpers.log(`🎯 Enhanced search completed: ${allResults.sources.length} total sources`, 'success');
    
    return allResults;
  }
}

// AI SERVICE
class AIService {
  constructor() {
    this.currentModelIndex = 0;
    this.successfulModels = new Set();
    this.endpoints = [
      'https://openrouter.ai/api/v1/chat/completions',
      'https://api.openrouter.ai/api/v1/chat/completions'
    ];
  }

  async getAIResponse(prompt, searchResults, context = {}) {
    Helpers.log('🤖 Getting comprehensive AI analysis...', 'info');
    
    for (const endpoint of this.endpoints) {
      for (let i = 0; i < config.openrouter.models.length; i++) {
        const model = config.openrouter.models[i];
        
        try {
          const fullPrompt = this.buildComprehensivePrompt(prompt, searchResults, context);

          const requestBody = {
            model: model,
            messages: [
              {
                role: "system",
                content: "You are a comprehensive research assistant. Analyze the search results thoroughly and provide detailed, well-structured answers. Include key facts, developments, and context."
              },
              {
                role: "user",
                content: fullPrompt
              }
            ],
            max_tokens: 2000,
            temperature: 0.7,
            top_p: 0.9
          };

          const response = await axios.post(endpoint, requestBody, {
            headers: {
              'Authorization': 'Bearer ' + config.openrouter.apiKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com',
              'X-Title': 'Web Search AI'
            },
            timeout: 60000
          });

          if (response.data?.choices?.[0]?.message?.content) {
            const aiResponse = response.data.choices[0].message.content;
            
            Helpers.log(`✅ Success with model: ${model}`, 'success');
            this.successfulModels.add(model);
            this.currentModelIndex = i;
            
            return {
              content: aiResponse,
              model: model,
              endpoint: endpoint
            };
          }
        } catch (error) {
          Helpers.log(`❌ Error with ${model}: ${error.response?.data?.error?.message || error.message}`, 'error');
        }
        
        if (i < config.openrouter.models.length - 1) {
          await Helpers.delay(4000);
        }
      }
      
      await Helpers.delay(2000);
    }

    Helpers.log('❌ All models failed, using enhanced fallback response', 'error');
    return {
      content: this.getEnhancedFallbackResponse(prompt, searchResults),
      model: 'enhanced-fallback',
      endpoint: 'none'
    };
  }

  buildComprehensivePrompt(userPrompt, searchResults, context = {}) {
    const currentYear = new Date().getFullYear();
    
    let searchContext = `RESEARCH REQUEST: "${userPrompt}"
Search Date: ${new Date().toISOString()}
Total Sources Analyzed: ${searchResults.sources.length}
Search Engines Used: ${searchResults.searchEnginesUsed.join(', ')}

SEARCH RESULTS:\n`;

    if (searchResults.sources.length > 0) {
      searchResults.sources.forEach((source, index) => {
        searchContext += `\n--- SOURCE ${index + 1} | ${source.type.toUpperCase()} | ${source.engine} ---\n`;
        searchContext += `TITLE: ${source.title || 'No title'}\n`;
        searchContext += `CONTENT: ${source.content}\n`;
        if (source.url) searchContext += `URL: ${source.url}\n`;
        searchContext += `--- END SOURCE ${index + 1} ---\n`;
      });
    } else {
      searchContext += "No specific search results found. Please provide a comprehensive answer based on your general knowledge about the topic.\n";
    }

    return `You are a research assistant analyzing web search results. Please provide a comprehensive, well-structured answer.

${searchContext}

USER'S QUESTION: ${userPrompt}

INSTRUCTIONS FOR YOUR RESPONSE:
1. Provide a comprehensive, detailed analysis
2. Structure your answer with clear sections
3. Include key facts, developments, and context
4. Be honest about any limitations in the search results
5. If information is limited, acknowledge this and provide relevant general knowledge
6. Focus on recent developments and current status
7. Make it informative and helpful

Please provide your comprehensive analysis:`;
  }

  getEnhancedFallbackResponse(prompt, searchResults) {
    let response = `# Comprehensive Analysis: ${prompt}\n\n`;
    
    if (searchResults.sources.length > 0) {
      response += `## 📊 Search Summary\n`;
      response += `Based on analysis of ${searchResults.sources.length} sources from ${searchResults.searchEnginesUsed.join(', ')}.\n\n`;
      
      response += `## 🔍 Key Information Found\n`;
      searchResults.sources.forEach((source, index) => {
        response += `\n### ${source.title || `Source ${index + 1}`}\n`;
        response += `${source.content}\n`;
        if (source.url) response += `*Source: ${source.url}*\n`;
      });
    } else {
      response += `## ℹ️ Search Status\n`;
      response += `No specific search results were found for "${prompt}".\n\n`;
      
      response += `## 💡 General Context\n`;
      response += `Based on available knowledge:\n\n`;
    }
    
    response += `\n## 🎯 For More Information\n`;
    response += `• Check official websites and recent publications\n`;
    response += `• Follow industry-specific news sources\n`;
    response += `• Consult academic papers for technical details\n`;
    
    return response;
  }

  getSuccessfulModels() {
    return Array.from(this.successfulModels);
  }
}

// FILE SERVICE WITH CHROME-LIKE OUTPUT
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
      const jsonFilename = `search-result-${Date.now()}.json`;
      const jsonFilePath = path.join(this.outputDir, jsonFilename);
      
      const resultData = {
        timestamp: timestamp,
        prompt: result.prompt,
        answer: result.answer,
        searchResults: result.searchResults,
        modelUsed: result.model,
        endpointUsed: result.endpoint,
        sourcesCount: result.searchResults.sources.length,
        searchEngines: result.searchResults.searchEnginesUsed,
        savedAt: new Date().toLocaleString()
      };

      fs.writeFileSync(jsonFilePath, JSON.stringify(resultData, null, 2));
      
      const htmlFilename = `search-result-${Date.now()}.html`;
      const htmlFilePath = path.join(this.outputDir, htmlFilename);
      const htmlContent = this.generateChromeLikeHTML(result);
      
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

  generateChromeLikeHTML(results) {
    const sourcesCount = results.searchResults?.sources?.length || 0;
    const enginesUsed = results.searchResults?.searchEnginesUsed?.join(', ') || 'N/A';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Search Results - ${Helpers.escapeHtml(results.prompt)}</title>
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
        
        .chrome-header {
            background: #ffffff;
            border-bottom: 1px solid #e8eaed;
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .search-box {
            background: #f1f3f4;
            border: 1px solid #dfe1e5;
            border-radius: 24px;
            padding: 12px 20px;
            font-size: 16px;
            color: #5f6368;
            flex: 1;
            max-width: 600px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 24px;
        }
        
        .search-stats {
            background: #ffffff;
            border: 1px solid #e8eaed;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            display: flex;
            gap: 24px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .stat-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: #5f6368;
        }
        
        .stat-value {
            font-weight: 600;
            color: #1a73e8;
        }
        
        .section {
            background: #ffffff;
            border: 1px solid #e8eaed;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: 600;
            color: #202124;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .ai-answer {
            background: #f8f9fa;
            border-left: 4px solid #1a73e8;
            padding: 20px;
            border-radius: 8px;
            white-space: pre-line;
            line-height: 1.8;
            font-size: 15px;
        }
        
        .result-item {
            border: 1px solid #e8eaed;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.2s ease;
        }
        
        .result-item:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-color: #1a73e8;
        }
        
        .result-title {
            font-size: 18px;
            font-weight: 600;
            color: #1a0dab;
            margin-bottom: 8px;
            text-decoration: none;
            display: block;
        }
        
        .result-title:hover {
            text-decoration: underline;
        }
        
        .result-url {
            color: #006621;
            font-size: 14px;
            margin-bottom: 8px;
            font-family: monospace;
        }
        
        .result-snippet {
            color: #4d5156;
            font-size: 14px;
            line-height: 1.6;
        }
        
        .result-meta {
            display: flex;
            gap: 12px;
            margin-top: 12px;
            font-size: 12px;
            color: #5f6368;
        }
        
        .meta-tag {
            background: #f1f3f4;
            padding: 4px 8px;
            border-radius: 4px;
        }
        
        .chrome-footer {
            background: #f8f9fa;
            border-top: 1px solid #e8eaed;
            padding: 16px 24px;
            text-align: center;
            color: #5f6368;
            font-size: 12px;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 16px;
            }
            
            .search-stats {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
            }
            
            .chrome-header {
                padding: 12px 16px;
            }
        }
    </style>
</head>
<body>
    <div class="chrome-header">
        <div class="search-box">${Helpers.escapeHtml(results.prompt || 'Search Results')}</div>
    </div>
    
    <div class="container">
        <div class="search-stats">
            <div class="stat-item">
                <span>🔍</span>
                <span>Sources Found: <span class="stat-value">${sourcesCount}</span></span>
            </div>
            <div class="stat-item">
                <span>🌐</span>
                <span>Search Engines: <span class="stat-value">${enginesUsed}</span></span>
            </div>
            <div class="stat-item">
                <span>🤖</span>
                <span>AI Model: <span class="stat-value">${results.model || 'N/A'}</span></span>
            </div>
            <div class="stat-item">
                <span>⏰</span>
                <span>Generated: <span class="stat-value">${new Date().toLocaleString()}</span></span>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">
                <span>🤖</span>
                AI Analysis
            </div>
            <div class="ai-answer">${Helpers.escapeHtml(results.answer || 'No analysis available.')}</div>
        </div>
        
        <div class="section">
            <div class="section-title">
                <span>🌐</span>
                Web Sources (${sourcesCount})
            </div>
            
            ${sourcesCount > 0 ? 
                results.searchResults.sources.map((source, index) => `
                    <div class="result-item">
                        ${source.url ? `<a href="${source.url}" class="result-title" target="_blank">${Helpers.escapeHtml(source.title || `Source ${index + 1}`)}</a>` : 
                          `<div class="result-title">${Helpers.escapeHtml(source.title || `Source ${index + 1}`)}</div>`}
                        ${source.url ? `<div class="result-url">${source.url}</div>` : ''}
                        <div class="result-snippet">${Helpers.escapeHtml(source.content || 'No content available.')}</div>
                        <div class="result-meta">
                            <span class="meta-tag">${source.type || 'unknown'}</span>
                            <span class="meta-tag">${source.engine || 'unknown'}</span>
                            <span class="meta-tag">Rank: ${source.rank || index + 1}</span>
                        </div>
                    </div>
                `).join('') : 
                '<div class="result-item"><div class="result-snippet">No web sources found for this query.</div></div>'
            }
        </div>
    </div>
    
    <div class="chrome-footer">
        Generated by Web Search AI Assistant • ${new Date().getFullYear()}
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
      Helpers.log(`🚀 Starting comprehensive processing: "${prompt}"`, 'info');
      
      const validatedPrompt = Helpers.validatePrompt(prompt);
      
      Helpers.log('🔍 Performing enhanced web search...', 'info');
      const searchResults = await this.searchService.enhancedSearch(validatedPrompt);
      
      Helpers.log('🤖 Getting AI analysis with comprehensive context...', 'info');
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

      Helpers.log(`✅ Comprehensive processing completed with model: ${aiResponse.model}`, 'success');
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
  console.log('🚀 Starting Web Search AI Assistant...');
  console.log('========================================\n');
  
  const assistant = new WebSearchAIAssistant();
  
  while (true) {
    console.log('\n📝 Choose an option:');
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
    "flying cars in 2025 latest developments and prototypes",
    "artificial intelligence in healthcare 2024 breakthroughs",
    "renewable energy trends and innovations this year",
    "space exploration recent achievements and missions"
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