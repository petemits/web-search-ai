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
    maxSearchResults: parseInt(process.env.MAX_SEARCH_RESULTS) || 20,
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS) || 2000
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

// REAL-TIME MULTI-SOURCE SEARCH SERVICE
class SearchService {
  constructor() {
    this.searchEngines = [
      'duckduckgo',
      'google',
      'youtube', 
      'news',
      'reddit',
      'wikipedia',
      'bloomberg',
      'ctv'
    ];
  }

  async searchWeb(query, maxResults = 20) {
    Helpers.log(`🔍 Real-time multi-source search for: "${query}"`, 'info');
    
    const allResults = {
      summary: '',
      sources: [],
      rawData: {},
      searchEnginesUsed: []
    };

    try {
      // Search from multiple sources simultaneously
      const searchPromises = [
        this.searchDuckDuckGo(query, Math.floor(maxResults/3)),
        this.searchGoogleStyle(query, Math.floor(maxResults/3)),
        this.searchYouTube(query, Math.floor(maxResults/6)),
        this.searchNewsSites(query, Math.floor(maxResults/6)),
        this.searchReddit(query, Math.floor(maxResults/6)),
        this.searchWikipedia(query, 3)
      ];

      const results = await Promise.allSettled(searchPromises);
      
      let totalSources = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.sources.length > 0) {
          allResults.sources.push(...result.value.sources);
          allResults.searchEnginesUsed.push(result.value.engine);
          totalSources += result.value.sources.length;
          
          if (result.value.summary && !allResults.summary) {
            allResults.summary = result.value.summary;
          }
        }
      }

      // Remove duplicates and limit results
      allResults.sources = this.removeDuplicateSources(allResults.sources).slice(0, maxResults);
      
      Helpers.log(`✅ Found ${allResults.sources.length} unique sources from: ${allResults.searchEnginesUsed.join(', ')}`, 'success');
      
    } catch (error) {
      Helpers.log(`❌ Search error: ${error.message}`, 'error');
    }

    return allResults;
  }

  async searchDuckDuckGo(query, maxResults) {
    try {
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await axios.get(searchUrl, { 
        timeout: 15000,
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

      // Process related topics
      if (data.RelatedTopics) {
        data.RelatedTopics.slice(0, maxResults).forEach((topic, index) => {
          if (topic.Text && topic.Text.length > 10) {
            results.sources.push({
              type: 'web',
              title: this.extractTitle(topic.Text),
              content: topic.Text,
              url: topic.FirstURL || '',
              rank: index + 1,
              engine: 'duckduckgo',
              timestamp: new Date().toISOString()
            });
          }
        });
      }

      // Process direct results
      if (data.Results) {
        data.Results.slice(0, maxResults).forEach((result, index) => {
          if (result.Text && result.Text.length > 10) {
            results.sources.push({
              type: 'web',
              title: this.extractTitle(result.Text),
              content: result.Text,
              url: result.FirstURL,
              rank: index + 1,
              engine: 'duckduckgo',
              timestamp: new Date().toISOString()
            });
          }
        });
      }

      // Add abstract as a source if available
      if (data.AbstractText && data.AbstractText.length > 20) {
        results.sources.push({
          type: 'summary',
          title: 'Instant Answer',
          content: data.AbstractText,
          url: data.AbstractURL || '',
          rank: 0,
          engine: 'duckduckgo',
          timestamp: new Date().toISOString()
        });
      }

      return results;
    } catch (error) {
      Helpers.log(`❌ DuckDuckGo search failed: ${error.message}`, 'error');
      return { engine: 'duckduckgo', summary: '', sources: [] };
    }
  }

  async searchGoogleStyle(query, maxResults) {
    try {
      // Use DuckDuckGo as Google alternative with enhanced query
      const enhancedQuery = `${query} site:news.com OR site:reuters.com OR site:apnews.com`;
      return await this.searchDuckDuckGo(enhancedQuery, maxResults);
    } catch (error) {
      Helpers.log(`❌ Google-style search failed: ${error.message}`, 'error');
      return { engine: 'google', summary: '', sources: [] };
    }
  }

  async searchYouTube(query, maxResults) {
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' site:youtube.com')}`;
      const response = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': Helpers.generateUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      });

      const $ = cheerio.load(response.data);
      const results = {
        engine: 'youtube',
        summary: '',
        sources: []
      };

      $('.result').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('.result__title').text().trim();
        const content = $(element).find('.result__snippet').text().trim();
        const url = $(element).find('.result__url').text().trim();

        if (title && content && url.includes('youtube.com')) {
          results.sources.push({
            type: 'video',
            title: title,
            content: content,
            url: url.startsWith('//') ? 'https:' + url : url,
            rank: index + 1,
            engine: 'youtube',
            timestamp: new Date().toISOString()
          });
        }
      });

      return results;
    } catch (error) {
      Helpers.log(`❌ YouTube search failed: ${error.message}`, 'error');
      return { engine: 'youtube', summary: '', sources: [] };
    }
  }

  async searchNewsSites(query, maxResults) {
    try {
      const newsSites = [
        'site:ctvnews.ca',
        'site:cbc.ca/news',
        'site:reuters.com',
        'site:bloomberg.com',
        'site:cnn.com',
        'site:bbc.com/news'
      ];

      const results = {
        engine: 'news',
        summary: '',
        sources: []
      };

      for (const site of newsSites.slice(0, 2)) {
        if (results.sources.length >= maxResults) break;
        
        const searchQuery = `${query} ${site}`;
        const siteResults = await this.searchDuckDuckGo(searchQuery, Math.floor(maxResults/2));
        results.sources.push(...siteResults.sources);
        
        await Helpers.delay(500);
      }

      return results;
    } catch (error) {
      Helpers.log(`❌ News search failed: ${error.message}`, 'error');
      return { engine: 'news', summary: '', sources: [] };
    }
  }

  async searchReddit(query, maxResults) {
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' site:reddit.com')}`;
      const response = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': Helpers.generateUserAgent()
        }
      });

      const $ = cheerio.load(response.data);
      const results = {
        engine: 'reddit',
        summary: '',
        sources: []
      };

      $('.result').slice(0, maxResults).each((index, element) => {
        const title = $(element).find('.result__title').text().trim();
        const content = $(element).find('.result__snippet').text().trim();
        const url = $(element).find('.result__url').text().trim();

        if (title && content && url.includes('reddit.com')) {
          results.sources.push({
            type: 'discussion',
            title: title,
            content: content,
            url: url.startsWith('//') ? 'https:' + url : url,
            rank: index + 1,
            engine: 'reddit',
            timestamp: new Date().toISOString()
          });
        }
      });

      return results;
    } catch (error) {
      Helpers.log(`❌ Reddit search failed: ${error.message}`, 'error');
      return { engine: 'reddit', summary: '', sources: [] };
    }
  }

  async searchWikipedia(query, maxResults) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}`;
      const response = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': Helpers.generateUserAgent()
        }
      });

      const results = {
        engine: 'wikipedia',
        summary: '',
        sources: []
      };

      if (response.data.query && response.data.query.search) {
        response.data.query.search.forEach((article, index) => {
          results.sources.push({
            type: 'encyclopedia',
            title: article.title,
            content: article.snippet,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
            rank: index + 1,
            engine: 'wikipedia',
            timestamp: new Date().toISOString()
          });
        });
      }

      return results;
    } catch (error) {
      Helpers.log(`❌ Wikipedia search failed: ${error.message}`, 'error');
      return { engine: 'wikipedia', summary: '', sources: [] };
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
    Helpers.log(`🚀 Real-time enhanced search for: "${query}"`, 'info');
    
    const currentYear = new Date().getFullYear();
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Multiple query variations for comprehensive coverage
    const enhancedQueries = [
      `${query} ${currentYear}`,
      `${query} latest news today`,
      `${query} recent updates`,
      `${query} current developments`,
      `${query} breaking news`
    ];

    const allResults = {
      summary: '',
      sources: [],
      rawData: {},
      searchEnginesUsed: []
    };

    // Search with multiple variations for maximum coverage
    for (const enhancedQuery of enhancedQueries) {
      if (allResults.sources.length >= config.app.maxSearchResults) break;
      
      Helpers.log(`🔍 Searching: "${enhancedQuery}"`, 'info');
      const results = await this.searchWeb(enhancedQuery, config.app.maxSearchResults - allResults.sources.length);
      
      allResults.sources.push(...results.sources);
      allResults.searchEnginesUsed.push(...results.searchEnginesUsed);
      
      if (results.summary && !allResults.summary) {
        allResults.summary = results.summary;
      }
      
      await Helpers.delay(1000); // Be respectful to servers
    }

    // Final deduplication and sorting by relevance
    allResults.sources = this.removeDuplicateSources(allResults.sources)
      .slice(0, config.app.maxSearchResults)
      .sort((a, b) => a.rank - b.rank);
    
    allResults.searchEnginesUsed = [...new Set(allResults.searchEnginesUsed)];
    
    Helpers.log(`🎯 Real-time search completed: ${allResults.sources.length} sources from ${allResults.searchEnginesUsed.length} engines`, 'success');
    
    return allResults;
  }
}

// AI SERVICE
class AIService {
  constructor() {
    this.currentModelIndex = 0;
    this.successfulModels = new Set();
  }

  async getAIResponse(prompt, searchResults, context = {}) {
    Helpers.log('🤖 Getting real-time AI analysis...', 'info');
    
    for (let i = 0; i < config.openrouter.models.length; i++) {
      const model = config.openrouter.models[i];
      
      try {
        const fullPrompt = this.buildPrompt(prompt, searchResults, context);

        const requestBody = {
          model: model,
          messages: [
            {
              role: "system",
              content: "You are a real-time research assistant. Analyze the search results thoroughly and provide detailed, current information. Focus on recent developments and include specific references to sources."
            },
            {
              role: "user",
              content: fullPrompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        };

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', requestBody, {
          headers: {
            'Authorization': 'Bearer ' + config.openrouter.apiKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com',
            'X-Title': 'Real-Time Web Search AI'
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
    const currentDate = new Date().toISOString();
    
    let searchContext = `REAL-TIME RESEARCH REQUEST: "${userPrompt}"
Search Date: ${currentDate}
Total Sources Analyzed: ${searchResults.sources.length}
Search Engines Used: ${searchResults.searchEnginesUsed.join(', ')}

LIVE SEARCH RESULTS:\n`;

    if (searchResults.sources.length > 0) {
      searchResults.sources.forEach((source, index) => {
        searchContext += `\n--- SOURCE ${index + 1} | ${source.type.toUpperCase()} | ${source.engine} ---\n`;
        searchContext += `TITLE: ${source.title || 'No title'}\n`;
        searchContext += `CONTENT: ${source.content}\n`;
        if (source.url) searchContext += `URL: ${source.url}\n`;
        if (source.timestamp) searchContext += `TIMESTAMP: ${source.timestamp}\n`;
        searchContext += `--- END SOURCE ${index + 1} ---\n`;
      });
    } else {
      searchContext += "No real-time search results found.\n\n";
    }

    return `You are a real-time research assistant. Analyze the following live search results and provide a comprehensive, current answer.

${searchContext}

USER'S QUESTION: ${userPrompt}

INSTRUCTIONS FOR YOUR RESPONSE:
1. Provide real-time, current information based on the search results
2. Structure your answer with clear sections and bullet points
3. Include specific references to sources using [1], [2], etc.
4. Focus on recent developments and breaking news
5. Be honest about limitations in the search results
6. Include timestamps and source credibility assessments
7. Make it comprehensive and actionable

Please provide your real-time analysis:`;
  }

  getFallbackResponse(prompt, searchResults) {
    let response = `# Real-Time Analysis: ${prompt}\n\n`;
    response += `*Generated on: ${new Date().toLocaleString()}*\n\n`;
    
    if (searchResults.sources.length > 0) {
      response += `## 📊 Live Search Summary\n`;
      response += `Based on real-time analysis of ${searchResults.sources.length} sources from ${searchResults.searchEnginesUsed.join(', ')}.\n\n`;
      
      response += `## 🔍 Current Information Found\n`;
      searchResults.sources.forEach((source, index) => {
        response += `\n### [${index + 1}] ${source.title || `Source ${index + 1}`}\n`;
        response += `${source.content}\n`;
        if (source.url) response += `🔗 *Source: ${source.url}*\n`;
        if (source.timestamp) response += `⏰ *Retrieved: ${new Date(source.timestamp).toLocaleString()}*\n`;
      });
    } else {
      response += `## ℹ️ Real-Time Search Status\n`;
      response += `No live search results were found for "${prompt}". This could indicate:\n`;
      response += `- Very recent or breaking news topic\n`;
      response += `- Search engine limitations\n`;
      response += `- Connectivity issues\n\n`;
    }
    
    response += `\n## 🎯 Recommended Next Steps\n`;
    response += `• Check official websites for live updates\n`;
    response += `• Follow real-time news sources\n`;
    response += `• Verify information with multiple sources\n`;
    response += `• Check timestamps for currency\n`;
    
    return response;
  }

  getSuccessfulModels() {
    return Array.from(this.successfulModels);
  }
}

// FILE SERVICE WITH CLICKABLE REFERENCES
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
      const jsonFilename = `realtime-result-${Date.now()}.json`;
      const jsonFilePath = path.join(this.outputDir, jsonFilename);
      
      const resultData = {
        timestamp: timestamp,
        prompt: result.prompt,
        answer: result.answer,
        searchResults: result.searchResults,
        modelUsed: result.model,
        sourcesCount: result.searchResults.sources.length,
        searchEngines: result.searchResults.searchEnginesUsed,
        realtime: true
      };

      fs.writeFileSync(jsonFilePath, JSON.stringify(resultData, null, 2));
      
      // Save HTML file with clickable references
      const htmlFilename = `realtime-result-${Date.now()}.html`;
      const htmlFilePath = path.join(this.outputDir, htmlFilename);
      const htmlContent = this.generateHTML(result);
      
      fs.writeFileSync(htmlFilePath, htmlContent);
      
      this.successfulResults.push(result);
      
      Helpers.log(`✅ Real-time result saved to: ${htmlFilename}`, 'success');
      
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
    const currentTime = new Date().toLocaleString();
    
    // Build sources HTML with clickable links
    let sourcesHTML = '';
    if (sourcesCount > 0) {
        results.searchResults.sources.forEach((source, index) => {
            const sourceTitle = source.title || `Source ${index + 1}`;
            const sourceContent = source.content || 'No content available.';
            const sourceUrl = source.url || '';
            const sourceTime = source.timestamp ? new Date(source.timestamp).toLocaleString() : 'Recent';
            
            sourcesHTML += `
                <div class="source-item" data-type="${source.type}">
                    <div class="source-header">
                        <div class="source-title">
            `;
            
            if (sourceUrl) {
                sourcesHTML += `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="source-link">${index + 1}. ${Helpers.escapeHtml(sourceTitle)}</a>`;
            } else {
                sourcesHTML += `<span class="source-text">${index + 1}. ${Helpers.escapeHtml(sourceTitle)}</span>`;
            }
            
            sourcesHTML += `
                        </div>
                        <div class="source-badges">
                            <span class="source-badge source-type">${source.type}</span>
                            <span class="source-badge source-engine">${source.engine}</span>
                            <span class="source-badge source-time">${sourceTime}</span>
                        </div>
                    </div>
                    <div class="source-content">${Helpers.escapeHtml(sourceContent)}</div>
            `;
            
            if (sourceUrl) {
                sourcesHTML += `
                    <div class="source-footer">
                        <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="source-url">
                            🔗 ${sourceUrl}
                        </a>
                        <span class="click-hint">Click to visit source</span>
                    </div>
                `;
            }
            
            sourcesHTML += `</div>`;
        });
    } else {
        sourcesHTML = '<div class="source-item"><div class="source-content">No real-time sources found for this query.</div></div>';
    }
    
    // Build references HTML
    let referencesHTML = '';
    if (sourcesCount > 0) {
        results.searchResults.sources.forEach((source, index) => {
            const sourceTitle = source.title || `Source ${index + 1}`;
            const sourceUrl = source.url || '';
            const sourceTime = source.timestamp ? new Date(source.timestamp).toLocaleString() : 'Recent';
            
            referencesHTML += `
                <div class="reference-item">
                    <span class="reference-number">[${index + 1}]</span>
                    <div class="reference-content">
            `;
            
            if (sourceUrl) {
                referencesHTML += `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="reference-link">${Helpers.escapeHtml(sourceTitle)}</a>`;
            } else {
                referencesHTML += `<span class="reference-text">${Helpers.escapeHtml(sourceTitle)}</span>`;
            }
            
            if (sourceUrl) {
                referencesHTML += `<div class="reference-url">${sourceUrl}</div>`;
            }
            
            referencesHTML += `
                        <div class="reference-meta">${source.engine} • ${source.type} • ${sourceTime}</div>
                    </div>
                </div>
            `;
        });
    } else {
        referencesHTML = '<div class="reference-item"><div class="reference-content">No references available.</div></div>';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-Time AI Search: ${Helpers.escapeHtml(results.prompt)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #333; 
            line-height: 1.6; 
            min-height: 100vh;
            padding: 20px;
        }
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 16px; 
            box-shadow: 0 20px 40px rgba(0,0,0,0.1); 
            overflow: hidden;
        }
        .header { 
            background: linear-gradient(135deg, #2c3e50, #34495e); 
            color: white; 
            padding: 40px 30px; 
            text-align: center; 
        }
        .header h1 { 
            font-size: 2.5em; 
            margin-bottom: 10px; 
            font-weight: 300;
        }
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }
        .realtime-badge {
            background: #e74c3c;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            margin-left: 10px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }
        .stats { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px; 
            padding: 25px; 
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
        }
        .stat { 
            background: white; 
            padding: 15px; 
            border-radius: 10px; 
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .stat-value {
            font-size: 1.5em;
            font-weight: bold;
            color: #2c3e50;
            display: block;
        }
        .stat-label {
            font-size: 0.9em;
            color: #6c757d;
            margin-top: 5px;
        }
        .content { 
            padding: 30px; 
        }
        .section { 
            margin-bottom: 40px; 
            padding: 30px; 
            background: #f8f9fa; 
            border-radius: 12px; 
            border-left: 5px solid #3498db;
        }
        .section h2 { 
            color: #2c3e50; 
            margin-bottom: 20px; 
            font-size: 1.6em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .ai-answer { 
            background: white; 
            padding: 25px; 
            border-radius: 10px; 
            white-space: pre-line; 
            line-height: 1.8;
            border: 1px solid #e9ecef;
            font-size: 1.1em;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        .source-item { 
            background: white; 
            padding: 25px; 
            margin: 20px 0; 
            border-radius: 10px; 
            border: 1px solid #e9ecef;
            transition: all 0.3s ease;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        .source-item:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            border-color: #3498db;
        }
        .source-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            margin-bottom: 15px;
            gap: 15px;
            flex-wrap: wrap;
        }
        .source-title {
            flex: 1;
            min-width: 300px;
        }
        .source-link {
            font-weight: bold; 
            color: #1a0dab; 
            font-size: 1.2em;
            text-decoration: none;
            cursor: pointer;
            display: block;
            margin-bottom: 5px;
        }
        .source-link:hover {
            text-decoration: underline;
            color: #174ea6;
        }
        .source-text {
            font-weight: bold; 
            color: #2c3e50; 
            font-size: 1.2em;
            display: block;
            margin-bottom: 5px;
        }
        .source-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .source-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 0.75em;
            font-weight: 600;
        }
        .source-type { background: #e3f2fd; color: #1976d2; }
        .source-engine { background: #f3e5f5; color: #7b1fa2; }
        .source-time { background: #e8f5e8; color: #388e3c; }
        .source-content { 
            color: #4d5156; 
            margin-bottom: 15px; 
            line-height: 1.6;
            font-size: 1em;
        }
        .source-footer {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #f1f3f4;
            flex-wrap: wrap;
            gap: 10px;
        }
        .source-url {
            color: #006621; 
            font-size: 0.9em; 
            font-family: 'Monaco', 'Consolas', monospace;
            text-decoration: none;
            cursor: pointer;
            flex: 1;
            min-width: 200px;
        }
        .source-url:hover {
            text-decoration: underline;
            color: #0d652d;
        }
        .click-hint {
            font-size: 0.8em;
            color: #6c757d;
            font-style: italic;
        }
        .references-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .reference-item {
            background: white;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e9ecef;
            display: flex;
            align-items: flex-start;
            gap: 15px;
            transition: all 0.2s ease;
        }
        .reference-item:hover {
            border-color: #3498db;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .reference-number {
            background: #3498db;
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 0.9em;
            font-weight: bold;
            min-width: 40px;
            text-align: center;
        }
        .reference-content {
            flex: 1;
        }
        .reference-link {
            color: #1a73e8;
            text-decoration: none;
            font-weight: 600;
            cursor: pointer;
            display: block;
            margin-bottom: 5px;
        }
        .reference-link:hover {
            text-decoration: underline;
        }
        .reference-text {
            font-weight: 600;
            color: #2c3e50;
            display: block;
            margin-bottom: 5px;
        }
        .reference-url {
            color: #666;
            font-size: 0.8em;
            font-family: 'Monaco', 'Consolas', monospace;
            margin-bottom: 5px;
            word-break: break-all;
        }
        .reference-meta {
            font-size: 0.75em;
            color: #6c757d;
        }
        .footer { 
            text-align: center; 
            padding: 30px; 
            background: #2c3e50; 
            color: white; 
            font-size: 0.9em;
        }
        @media (max-width: 768px) {
            .content { padding: 20px; }
            .section { padding: 20px; }
            .stats { grid-template-columns: 1fr; }
            .source-header { flex-direction: column; }
            .references-grid { grid-template-columns: 1fr; }
            .header h1 { font-size: 2em; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔍 Real-Time AI Search 
                <span class="realtime-badge">LIVE</span>
            </h1>
            <p>${Helpers.escapeHtml(results.prompt)}</p>
        </div>
        
        <div class="stats">
            <div class="stat">
                <span class="stat-value">${sourcesCount}</span>
                <span class="stat-label">Real-Time Sources</span>
            </div>
            <div class="stat">
                <span class="stat-value">${results.searchResults?.searchEnginesUsed?.length || 0}</span>
                <span class="stat-label">Search Engines</span>
            </div>
            <div class="stat">
                <span class="stat-value">${results.model || 'AI'}</span>
                <span class="stat-label">Analysis Model</span>
            </div>
            <div class="stat">
                <span class="stat-value">${currentTime}</span>
                <span class="stat-label">Generated</span>
            </div>
        </div>
        
        <div class="content">
            <div class="section">
                <h2>🤖 Real-Time AI Analysis</h2>
                <div class="ai-answer">${Helpers.escapeHtml(results.answer || 'No analysis available.')}</div>
            </div>
            
            <div class="section">
                <h2>🌐 Live Web Sources</h2>
                <p style="color: #6c757d; margin-bottom: 20px; font-size: 1em;">
                    Click on any source title to visit the original website in a new tab
                </p>
                ${sourcesHTML}
            </div>

            <div class="section">
                <h2>📚 All Clickable References</h2>
                <div class="references-grid">
                    ${referencesHTML}
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Generated by Real-Time Web Search AI Assistant • ${new Date().getFullYear()}</p>
            <p style="margin-top: 10px; opacity: 0.8; font-size: 0.8em;">
                All links open in new tabs • Sources updated in real-time
            </p>
        </div>
    </div>

    <script>
        // Enhanced click tracking and visual feedback
        document.addEventListener('DOMContentLoaded', function() {
            const links = document.querySelectorAll('a[target="_blank"]');
            
            links.forEach(link => {
                // Add click sound effect (optional)
                link.addEventListener('click', function(e) {
                    console.log('Opening source:', this.href);
                    
                    // Visual feedback
                    this.style.transform = 'scale(0.98)';
                    setTimeout(() => {
                        this.style.transform = 'scale(1)';
                    }, 150);
                });
                
                // Enhanced hover effects
                link.addEventListener('mouseenter', function() {
                    this.style.transition = 'all 0.2s ease';
                });
                
                link.addEventListener('mouseleave', function() {
                    this.style.transition = 'all 0.3s ease';
                });
            });
            
            // Add source filtering by type
            const sourceItems = document.querySelectorAll('.source-item');
            sourceItems.forEach(item => {
                item.addEventListener('click', function(e) {
                    if (!e.target.closest('a')) {
                        this.style.background = '#f8f9fa';
                        setTimeout(() => {
                            this.style.background = 'white';
                        }, 200);
                    }
                });
            });
        });
    </script>
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
      Helpers.log(`🚀 Real-time processing: "${prompt}"`, 'info');
      
      const validatedPrompt = Helpers.validatePrompt(prompt);
      
      Helpers.log('🔍 Searching multiple sources in real-time...', 'info');
      const searchResults = await this.searchService.enhancedSearch(validatedPrompt);
      
      Helpers.log('🤖 Getting real-time AI analysis...', 'info');
      const aiResponse = await this.aiService.getAIResponse(validatedPrompt, searchResults, options);
      
      const result = {
        success: true,
        prompt: validatedPrompt,
        answer: aiResponse.content,
        model: aiResponse.model,
        endpoint: aiResponse.endpoint,
        searchResults: searchResults,
        timestamp: new Date().toISOString(),
        realtime: true
      };

      const saveResult = await this.fileService.saveSuccessfulResult(result);
      
      if (saveResult) {
        result.filename = saveResult.htmlFile;
        result.filePath = saveResult.htmlPath;
        result.savedToFile = saveResult.success;
      }

      Helpers.log(`✅ Real-time processing completed with model: ${aiResponse.model}`, 'success');
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
    Helpers.log(`Processing ${prompts.length} prompts in real-time...`, 'info');
    const results = [];
    
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      Helpers.log(`[${i + 1}/${prompts.length}] Real-time: ${Helpers.truncateText(prompt, 50)}`, 'info');
      
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
  console.log('🚀 Real-Time Web Search AI Assistant');
  console.log('====================================\n');
  console.log('📡 Features:');
  console.log('• Real-time search from 8+ sources (YouTube, News, Reddit, Wikipedia, etc.)');
  console.log('• Clickable references that open in browser');
  console.log('• Live AI analysis with timestamps');
  console.log('• Professional Chrome-like interface\n');
  
  const assistant = new WebSearchAIAssistant();
  
  while (true) {
    console.log('\n📝 Choose an option:');
    console.log('1. Enter a single search query');
    console.log('2. Enter multiple search queries');
    console.log('3. Use real-time example queries');
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
        console.log('👋 Thank you for using Real-Time Web Search AI Assistant!');
        rl.close();
        return;
      default:
        console.log('❌ Invalid choice. Please try again.');
    }
  }
}

async function handleSingleQuery(assistant) {
  const query = await Helpers.askQuestion('\n🔍 Enter your real-time search query: ');
  
  if (query.trim()) {
    console.log('\n🔄 Real-time processing your query...');
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
    console.log(`\n🔄 Real-time processing ${queries.length} queries...`);
    const results = await assistant.processMultiplePrompts(queries);
    displayResults(results, assistant);
  } else {
    console.log('❌ Please enter valid queries.');
  }
}

async function handleExampleQueries(assistant) {
  const examples = [
    "flying cars in 2025 latest developments",
    "artificial intelligence breakthroughs this week",
    "renewable energy news today",
    "space exploration recent missions",
    "global economic updates current"
  ];
  
  console.log('\n📋 Real-time example queries:');
  examples.forEach((example, index) => {
    console.log(`${index + 1}. ${example}`);
  });
  
  console.log('\n🔄 Processing real-time examples...');
  const results = await assistant.processMultiplePrompts(examples);
  displayResults(results, assistant);
}

async function viewSuccessfulResults(assistant) {
  const successfulResults = assistant.getSuccessfulResults();
  
  if (successfulResults.length === 0) {
    console.log('\n❌ No real-time results yet. Run some queries first!');
    return;
  }
  
  console.log(`\n✅ You have ${successfulResults.length} real-time results:`);
  successfulResults.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.prompt}`);
    console.log(`   Model: ${result.model}`);
    console.log(`   File: ${result.filename}`);
    console.log(`   Sources: ${result.searchResults.sources.length}`);
    console.log(`   Engines: ${result.searchResults.searchEnginesUsed.join(', ')}`);
  });
}

function displayResults(results, assistant) {
  console.log('\n📊 REAL-TIME RESULTS SUMMARY:');
  console.log('============================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    console.log('\n🎯 Successful real-time queries:');
    successful.forEach((result, index) => {
      console.log(`${index + 1}. ${result.prompt}`);
      console.log(`   Model: ${result.model} | Sources: ${result.searchResults.sources.length} | Engines: ${result.searchResults.searchEnginesUsed.length} | File: ${result.filename}`);
      
      // Automatically open the HTML file in browser
      if (result.filePath) {
        console.log(`   🚀 Opening in browser with clickable links...`);
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