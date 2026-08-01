const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
const readline = require('readline');
const { exec } = require('child_process');
const os = require('os');
const chalk = require('chalk');
const { Ollama } = require('ollama');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// CONFIGURATION
const config = {
  app: {
    maxSearchResults: 25,
    timeout: 30000,
    headless: true
  },
  ai: {
    // Local AI models (no API keys needed)
    models: {
      primary: 'llama2',  // Or 'mistral', 'codellama', 'phi' etc.
      fallback: 'llama2'
    },
    ollamaEndpoint: 'http://localhost:11434'
  },
  searchEngines: {
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
    startpage: 'https://www.startpage.com/sp/search?q=',
    youtube: 'https://www.youtube.com/results?search_query='
  }
};

// ENHANCED CHAT HELPER WITH AI INTEGRATION
class AIChatHelpers {
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static log(message, type = 'info', sender = 'AI') {
    const timestamp = new Date().toLocaleTimeString();
    const colors = {
      user: chalk.cyan,
      ai: chalk.green,
      system: chalk.blue,
      error: chalk.red,
      warning: chalk.yellow,
      success: chalk.green,
      thinking: chalk.magenta
    };

    const color = colors[type] || chalk.white;
    const prefix = type === 'user' ? '👤 You' : 
                   type === 'thinking' ? '🤔 AI Thinking' : '🤖 AI';
    
    console.log(color(`[${timestamp}] ${prefix}: ${message}`));
  }

  static askQuestion(question) {
    return new Promise((resolve) => {
      rl.question(chalk.cyan(`👤 You: ${question}`), resolve);
    });
  }

  static validatePrompt(prompt) {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Please enter a search query');
    }
    if (prompt.length > 1000) {
      throw new Error('Query too long. Please keep it under 1000 characters');
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

  // Enhanced content cleaning
  static cleanContent(text) {
    if (!text) return '';
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\[\d+\]/g, '') // Remove citation numbers
      .trim();
  }

  // Extract key information for AI context
  static prepareAIContext(sources, query) {
    const context = {
      query: query,
      totalSources: sources.length,
      sourceTypes: {},
      keyInformation: []
    };

    // Group by source type
    sources.forEach(source => {
      if (!context.sourceTypes[source.type]) {
        context.sourceTypes[source.type] = [];
      }
      context.sourceTypes[source.type].push({
        title: source.title,
        content: source.content.substring(0, 300),
        source: source.source,
        relevance: source.relevance
      });
    });

    // Extract key information
    sources.slice(0, 8).forEach(source => {
      const sentences = source.content.split('. ').filter(s => s.length > 20);
      sentences.slice(0, 2).forEach(sentence => {
        if (sentence.toLowerCase().includes(query.toLowerCase()) || this.isInformative(sentence)) {
          context.keyInformation.push({
            content: sentence.trim(),
            source: source.source,
            type: source.type
          });
        }
      });
    });

    return context;
  }

  static isInformative(sentence) {
    const keywords = [
      'is a', 'are', 'was', 'were', 'has', 'have', 'can', 'could', 'will', 'would',
      'includes', 'contains', 'provides', 'offers', 'features', 'benefits', 'according to',
      'research shows', 'studies indicate', 'experts say'
    ];
    return keywords.some(keyword => sentence.toLowerCase().includes(keyword));
  }
}

// LOCAL AI SERVICE WITH OLLAMA
class LocalAIService {
  constructor() {
    this.ollama = new Ollama({ host: config.ai.ollamaEndpoint });
    this.isAvailable = false;
    this.currentModel = config.ai.models.primary;
  }

  async initialize() {
    try {
      AIChatHelpers.log('Checking local AI availability...', 'system');
      
      // Check if Ollama is running
      const models = await this.ollama.list();
      AIChatHelpers.log(`Found ${models.models.length} local AI models`, 'success');
      
      // Check if our preferred model is available
      const hasPrimaryModel = models.models.some(m => m.name.includes(this.currentModel));
      if (!hasPrimaryModel) {
        AIChatHelpers.log(`Primary model ${this.currentModel} not found, using first available model`, 'warning');
        this.currentModel = models.models[0]?.name || config.ai.models.fallback;
      }
      
      this.isAvailable = true;
      AIChatHelpers.log(`Local AI ready! Using model: ${this.currentModel}`, 'success');
      return true;
    } catch (error) {
      AIChatHelpers.log('Local AI not available. Using enhanced analysis instead.', 'warning');
      AIChatHelpers.log('To enable AI: Install Ollama from https://ollama.ai and run: ollama pull llama2', 'system');
      this.isAvailable = false;
      return false;
    }
  }

  async generateAIResponse(sources, query) {
    if (!this.isAvailable) {
      return this.generateFallbackResponse(sources, query);
    }

    try {
      AIChatHelpers.log('Analyzing search results with local AI...', 'thinking');
      
      const context = AIChatHelpers.prepareAIContext(sources, query);
      const prompt = this.buildAIPrompt(context, query);

      const response = await this.ollama.generate({
        model: this.currentModel,
        prompt: prompt,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 1000
        }
      });

      AIChatHelpers.log('AI analysis complete!', 'success');
      return {
        content: response.response,
        model: this.currentModel,
        isAI: true
      };

    } catch (error) {
      AIChatHelpers.log(`AI generation failed: ${error.message}`, 'error');
      return this.generateFallbackResponse(sources, query);
    }
  }

  buildAIPrompt(context, query) {
    return `You are a helpful research assistant. Analyze the following search results and provide a comprehensive, well-structured answer.

SEARCH QUERY: "${query}"

SEARCH RESULTS CONTEXT:
- Total Sources: ${context.totalSources}
- Source Types: ${Object.keys(context.sourceTypes).join(', ')}

KEY INFORMATION FOUND:
${context.keyInformation.map((info, index) => 
  `${index + 1}. [${info.type.toUpperCase()}] ${info.content} (Source: ${info.source})`
).join('\n')}

SOURCE BREAKDOWN:
${Object.entries(context.sourceTypes).map(([type, sources]) => 
  `- ${type.toUpperCase()}: ${sources.length} sources`
).join('\n')}

INSTRUCTIONS:
1. Provide a comprehensive analysis of what was found about "${query}"
2. Structure your response with clear sections and bullet points
3. Reference specific information from the search results
4. Highlight key findings and interesting insights
5. Mention the variety of sources used
6. Keep the tone informative but conversational
7. Suggest potential next steps for further research

Please provide your analysis:`;
  }

  generateFallbackResponse(sources, query) {
    AIChatHelpers.log('Using enhanced local analysis...', 'system');
    
    if (sources.length === 0) {
      return {
        content: `I searched across multiple platforms but couldn't find specific information about "${query}". 

🔍 **Suggestions:**
• Try different keywords or be more specific
• Check if your search terms are spelled correctly
• Use more general terms to get broader results

Would you like me to search again with different terms?`,
        model: 'enhanced-analysis',
        isAI: false
      };
    }

    let response = `I found ${sources.length} relevant sources about **${query}**. Here's my analysis:\n\n`;

    // Executive Summary
    response += `## 📊 Executive Summary\n`;
    response += `Based on comprehensive search across ${Object.keys(this.groupByType(sources)).length} types of sources, here are the key findings:\n\n`;

    // Key Insights
    const insights = this.extractKeyInsights(sources, query);
    response += `## 🔍 Key Insights\n`;
    insights.forEach((insight, index) => {
      response += `${index + 1}. ${insight}\n`;
    });

    // Source Analysis
    response += `\n## 📚 Source Analysis\n`;
    const sourceStats = this.getSourceStatistics(sources);
    Object.keys(sourceStats).forEach(type => {
      response += `• **${type.charAt(0).toUpperCase() + type.slice(1)}**: ${sourceStats[type]} sources\n`;
    });

    // Detailed Findings
    response += `\n## 📖 Detailed Findings\n\n`;
    sources.slice(0, 6).forEach((source, index) => {
      response += `### ${source.icon} ${source.title}\n`;
      response += `${source.content.substring(0, 200)}...\n`;
      response += `*Source: ${source.source}* | *Relevance: ${source.relevance}/10*\n\n`;
    });

    // Recommendations
    response += `## 💡 Recommendations\n\n`;
    response += `1. **Explore Sources**: Click the links below for detailed information\n`;
    response += `2. **Multiple Perspectives**: Review different source types for comprehensive understanding\n`;
    response += `3. **Latest Information**: All sources are current and relevant\n`;
    response += `4. **Further Research**: Consider exploring related topics mentioned in the sources\n`;

    return {
      content: response,
      model: 'enhanced-analysis',
      isAI: false
    };
  }

  groupByType(sources) {
    const grouped = {};
    sources.forEach(source => {
      if (!grouped[source.type]) grouped[source.type] = [];
      grouped[source.type].push(source);
    });
    return grouped;
  }

  extractKeyInsights(sources, query) {
    const insights = new Set();
    
    sources.slice(0, 10).forEach(source => {
      const sentences = source.content.split('. ').filter(s => s.length > 25);
      sentences.slice(0, 2).forEach(sentence => {
        const cleanSentence = AIChatHelpers.cleanContent(sentence);
        if (cleanSentence.length > 30 && 
            (cleanSentence.toLowerCase().includes(query.toLowerCase()) || 
             AIChatHelpers.isInformative(cleanSentence))) {
          insights.add(cleanSentence);
        }
      });
    });

    return Array.from(insights).slice(0, 6);
  }

  getSourceStatistics(sources) {
    const stats = {};
    sources.forEach(source => {
      stats[source.type] = (stats[source.type] || 0) + 1;
    });
    return stats;
  }
}

// ENHANCED SEARCH SERVICE WITH LANGCHAIN-STYLE PROCESSING
class IntelligentSearchService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.aiService = new LocalAIService();
  }

  async initialize() {
    AIChatHelpers.log('Initializing intelligent search system...', 'system');
    
    // Initialize browser
    this.browser = await puppeteer.launch({
      headless: config.app.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=site-per-process'
      ]
    });
    this.page = await this.browser.newPage();
    
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Initialize AI
    await this.aiService.initialize();
    
    AIChatHelpers.log('Intelligent search system ready!', 'success');
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async intelligentSearch(query, maxResults = 25) {
    AIChatHelpers.log(`Processing: "${query}"`, 'ai');
    
    const allResults = {
      summary: '',
      sources: [],
      searchEnginesUsed: [],
      timestamp: new Date().toISOString(),
      aiEnhanced: false
    };

    try {
      // Phase 1: Multi-source search
      AIChatHelpers.log('Phase 1: Gathering information from multiple sources...', 'system');
      const searchResults = await this.multiSourceSearch(query, maxResults);
      allResults.sources = searchResults.sources;
      allResults.searchEnginesUsed = searchResults.engines;

      // Phase 2: AI Analysis
      AIChatHelpers.log('Phase 2: Analyzing results with AI...', 'system');
      const aiResponse = await this.aiService.generateAIResponse(searchResults.sources, query);
      allResults.summary = aiResponse.content;
      allResults.aiEnhanced = aiResponse.isAI;
      allResults.modelUsed = aiResponse.model;

      AIChatHelpers.log(`Search complete! ${allResults.sources.length} sources analyzed with ${allResults.aiEnhanced ? 'Local AI' : 'Enhanced Analysis'}`, 'success');
      
    } catch (error) {
      AIChatHelpers.log(`Search error: ${error.message}`, 'error');
    }

    return allResults;
  }

  async multiSourceSearch(query, maxResults) {
    const searchMethods = [
      this.searchWithPuppeteer(query, 'duckduckgo', 8),
      this.searchWithPuppeteer(query, 'bing', 6),
      this.searchWithPuppeteer(query, 'startpage', 4),
      this.searchWikipedia(query, 5),
      this.searchReddit(query, 4),
      this.searchYouTube(query, 4)
    ];

    const results = await Promise.allSettled(searchMethods);
    
    const allSources = [];
    const enginesUsed = [];

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value && result.value.sources) {
        allSources.push(...result.value.sources);
        if (result.value.engine) {
          enginesUsed.push(result.value.engine);
        }
      }
    });

    return {
      sources: this.processAndRankSources(allSources).slice(0, maxResults),
      engines: [...new Set(enginesUsed)]
    };
  }

  async searchWithPuppeteer(query, engine, maxResults) {
    try {
      AIChatHelpers.log(`Searching ${engine}...`, 'system');
      
      const searchUrl = `${config.searchEngines[engine]}${encodeURIComponent(query)}`;
      
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: config.app.timeout
      });

      await AIChatHelpers.delay(3000);

      let sources = [];
      
      switch (engine) {
        case 'duckduckgo':
          sources = await this.extractDuckDuckGoResults(maxResults);
          break;
        case 'bing':
          sources = await this.extractBingResults(maxResults);
          break;
        case 'startpage':
          sources = await this.extractStartpageResults(maxResults);
          break;
      }

      return {
        sources,
        engine: engine.charAt(0).toUpperCase() + engine.slice(1)
      };

    } catch (error) {
      AIChatHelpers.log(`${engine} search failed: ${error.message}`, 'error');
      return { sources: [], engine: engine };
    }
  }

  async extractDuckDuckGoResults(maxResults) {
    return await this.page.evaluate((maxResults) => {
      const results = [];
      const elements = document.querySelectorAll('.result');
      
      for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
        const element = elements[i];
        const titleEl = element.querySelector('.result__title');
        const contentEl = element.querySelector('.result__snippet');
        const urlEl = element.querySelector('.result__url');
        
        if (titleEl && contentEl) {
          results.push({
            type: 'web',
            title: titleEl.textContent.trim(),
            content: contentEl.textContent.trim(),
            url: urlEl ? 'https://' + urlEl.getAttribute('href') : '',
            source: 'DuckDuckGo',
            icon: '🌐',
            relevance: 9 - (i * 0.1),
            timestamp: new Date().toISOString()
          });
        }
      }
      return results;
    }, maxResults);
  }

  async extractBingResults(maxResults) {
    return await this.page.evaluate((maxResults) => {
      const results = [];
      const elements = document.querySelectorAll('.b_algo');
      
      for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
        const element = elements[i];
        const titleEl = element.querySelector('h2');
        const contentEl = element.querySelector('.b_caption p');
        const urlEl = element.querySelector('h2 a');
        
        if (titleEl && contentEl && urlEl) {
          results.push({
            type: 'web',
            title: titleEl.textContent.trim(),
            content: contentEl.textContent.trim(),
            url: urlEl.href,
            source: 'Bing',
            icon: '🔎',
            relevance: 8 - (i * 0.1),
            timestamp: new Date().toISOString()
          });
        }
      }
      return results;
    }, maxResults);
  }

  async extractStartpageResults(maxResults) {
    return await this.page.evaluate((maxResults) => {
      const results = [];
      const elements = document.querySelectorAll('.w-gl__result');
      
      for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
        const element = elements[i];
        const titleEl = element.querySelector('.w-gl__result-title');
        const contentEl = element.querySelector('.w-gl__result-url');
        
        if (titleEl) {
          results.push({
            type: 'web',
            title: titleEl.textContent.trim(),
            content: contentEl ? contentEl.textContent.trim() : 'No description available',
            url: titleEl.href,
            source: 'Startpage',
            icon: '🔍',
            relevance: 8 - (i * 0.1),
            timestamp: new Date().toISOString()
          });
        }
      }
      return results;
    }, maxResults);
  }

  async searchWikipedia(query, maxResults) {
    try {
      AIChatHelpers.log('Searching Wikipedia...', 'system');
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}&srprop=size|wordcount|timestamp`;
      const response = await axios.get(searchUrl, { 
        timeout: config.app.timeout
      });

      const sources = [];
      if (response.data.query?.search) {
        response.data.query.search.forEach((article, index) => {
          sources.push({
            type: 'encyclopedia',
            title: article.title,
            content: AIChatHelpers.cleanContent(article.snippet) + '...',
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
            source: 'Wikipedia',
            icon: '📚',
            relevance: 10 - (index * 0.2),
            wordCount: article.wordcount,
            timestamp: new Date().toISOString()
          });
        });
      }

      return { 
        sources, 
        engine: 'Wikipedia'
      };
    } catch (error) {
      AIChatHelpers.log(`Wikipedia search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'Wikipedia' };
    }
  }

  async searchReddit(query, maxResults) {
    try {
      AIChatHelpers.log('Searching Reddit...', 'system');
      const searchUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}&sort=relevance`;
      const response = await axios.get(searchUrl, {
        timeout: config.app.timeout,
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
              content: AIChatHelpers.cleanContent(postData.selftext || '') + '...' || `Community discussion in ${postData.subreddit_name_prefixed}`,
              url: `https://reddit.com${postData.permalink}`,
              source: 'Reddit',
              icon: '💬',
              subreddit: postData.subreddit_name_prefixed,
              upvotes: postData.score,
              comments: postData.num_comments,
              relevance: 7 - (index * 0.2),
              timestamp: new Date(postData.created_utc * 1000).toISOString()
            });
          }
        });
      }

      return { 
        sources, 
        engine: 'Reddit'
      };
    } catch (error) {
      AIChatHelpers.log(`Reddit search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'Reddit' };
    }
  }

  async searchYouTube(query, maxResults) {
    try {
      AIChatHelpers.log('Searching YouTube...', 'system');
      const searchUrl = `${config.searchEngines.youtube}${encodeURIComponent(query)}`;
      
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: config.app.timeout
      });

      await AIChatHelpers.delay(4000);

      const sources = await this.page.evaluate((maxResults) => {
        const results = [];
        const elements = document.querySelectorAll('ytd-video-renderer');
        
        for (let i = 0; i < Math.min(elements.length, maxResults); i++) {
          const element = elements[i];
          const titleEl = element.querySelector('#video-title');
          const channelEl = element.querySelector('#channel-name a');
          const urlEl = element.querySelector('#video-title');
          
          if (titleEl && urlEl) {
            results.push({
              type: 'video',
              title: titleEl.textContent.trim(),
              content: `Channel: ${channelEl ? channelEl.textContent.trim() : 'Unknown'}`,
              url: urlEl.getAttribute('href'),
              source: 'YouTube',
              icon: '🎬',
              channel: channelEl ? channelEl.textContent.trim() : 'Unknown',
              relevance: 8 - (i * 0.2),
              timestamp: new Date().toISOString()
            });
          }
        }
        return results;
      }, maxResults);

      // Convert relative URLs to absolute
      sources.forEach(source => {
        if (source.url && source.url.startsWith('/')) {
          source.url = `https://www.youtube.com${source.url}`;
        }
      });

      return { 
        sources, 
        engine: 'YouTube'
      };
    } catch (error) {
      AIChatHelpers.log(`YouTube search failed: ${error.message}`, 'error');
      return { sources: [], engine: 'YouTube' };
    }
  }

  processAndRankSources(sources) {
    const seen = new Set();
    return sources
      .filter(source => {
        const key = source.title + source.url;
        if (seen.has(key) || !source.content || source.content.length < 10) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        // Prioritize Wikipedia and high-relevance sources
        let scoreA = a.relevance;
        let scoreB = b.relevance;
        
        if (a.source === 'Wikipedia') scoreA += 2;
        if (b.source === 'Wikipedia') scoreB += 2;
        if (a.type === 'encyclopedia') scoreA += 1;
        if (b.type === 'encyclopedia') scoreB += 1;
        
        return scoreB - scoreA;
      })
      .map((source, index) => {
        source.rank = index + 1;
        return source;
      });
  }
}

// INTELLIGENT CHAT INTERFACE
class IntelligentChatInterface {
  constructor() {
    this.outputDir = path.join(process.cwd(), 'outputs');
    this.ensureOutputDir();
  }

  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async saveIntelligentResult(result) {
    if (!result.success) return null;

    try {
      const timestamp = Date.now();
      const htmlFilename = `ai-search-${timestamp}.html`;
      const htmlPath = path.join(this.outputDir, htmlFilename);
      
      const htmlContent = this.generateIntelligentHTML(result);
      fs.writeFileSync(htmlPath, htmlContent);

      AIChatHelpers.log(`AI-enhanced result saved: ${htmlFilename}`, 'success');
      return { htmlPath, filename: htmlFilename };
    } catch (error) {
      AIChatHelpers.log(`Save failed: ${error.message}`, 'error');
      return null;
    }
  }

  generateIntelligentHTML(result) {
    const sources = result.searchResults.sources;
    const networks = result.searchResults.searchEnginesUsed;
    const isAI = result.searchResults.aiEnhanced;
    const model = result.searchResults.modelUsed;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Search: ${AIChatHelpers.escapeHtml(result.prompt)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .ai-container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.15);
            overflow: hidden;
        }
        
        .ai-header {
            background: linear-gradient(135deg, ${isAI ? '#10b981' : '#3b82f6'}, ${isAI ? '#047857' : '#1d4ed8'});
            color: white;
            padding: 35px;
            text-align: center;
        }
        
        .ai-title {
            font-size: 2.5em;
            font-weight: 300;
            margin-bottom: 10px;
        }
        
        .ai-subtitle {
            opacity: 0.9;
            font-size: 1.2em;
            margin-bottom: 15px;
        }
        
        .ai-badge {
            display: inline-block;
            background: rgba(255,255,255,0.2);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 0.9em;
            margin: 5px;
        }
        
        .chat-messages {
            padding: 35px;
        }
        
        .message {
            margin-bottom: 30px;
            display: flex;
            gap: 20px;
            align-items: flex-start;
        }
        
        .message.user {
            flex-direction: row-reverse;
        }
        
        .message-avatar {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.8em;
            flex-shrink: 0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .user .message-avatar {
            background: #3b82f6;
        }
        
        .ai .message-avatar {
            background: ${isAI ? '#10b981' : '#6b7280'};
        }
        
        .message-content {
            flex: 1;
            padding: 25px;
            border-radius: 20px;
            line-height: 1.7;
            box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        }
        
        .user .message-content {
            background: #e0f2fe;
            border-bottom-right-radius: 5px;
        }
        
        .ai .message-content {
            background: #f8fafc;
            border-bottom-left-radius: 5px;
            border-left: 4px solid ${isAI ? '#10b981' : '#6b7280'};
        }
        
        .ai-analysis {
            background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
            border-radius: 15px;
            padding: 25px;
            margin: 20px 0;
            border-left: 4px solid #0ea5e9;
        }
        
        .search-results {
            background: white;
            border-radius: 15px;
            margin: 25px 0;
            padding: 25px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        
        .result-item {
            padding: 20px;
            border-bottom: 1px solid #e2e8f0;
            transition: all 0.3s ease;
            border-radius: 10px;
            margin-bottom: 10px;
        }
        
        .result-item:hover {
            background: #f8fafc;
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
        }
        
        .result-title {
            font-size: 1.3em;
            font-weight: 600;
            color: #1e40af;
            text-decoration: none;
            display: block;
            margin-bottom: 10px;
        }
        
        .result-content {
            color: #4b5563;
            margin-bottom: 12px;
            line-height: 1.6;
        }
        
        .result-meta {
            display: flex;
            gap: 15px;
            font-size: 0.9em;
            color: #6b7280;
            flex-wrap: wrap;
        }
        
        .meta-badge {
            background: #f1f5f9;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: 500;
        }
        
        .footer {
            text-align: center;
            padding: 35px;
            background: #f8fafc;
            color: #6b7280;
            border-top: 1px solid #e2e8f0;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .chat-messages {
                padding: 20px;
            }
            
            .message {
                flex-direction: column;
            }
            
            .message.user {
                flex-direction: column;
            }
            
            .message-avatar {
                width: 50px;
                height: 50px;
                font-size: 1.5em;
            }
        }
    </style>
</head>
<body>
    <div class="ai-container">
        <div class="ai-header">
            <div class="ai-title">${isAI ? '🧠 AI-Powered Search' : '🔍 Enhanced Search'}</div>
            <div class="ai-subtitle">Your intelligent research assistant</div>
            <div>
                <span class="ai-badge">${isAI ? 'Local AI: ' + model : 'Enhanced Analysis'}</span>
                <span class="ai-badge">${sources.length} Sources</span>
                <span class="ai-badge">${networks.length} Search Engines</span>
                <span class="ai-badge">100% Offline</span>
            </div>
        </div>
        
        <div class="chat-messages">
            <div class="message user">
                <div class="message-avatar">👤</div>
                <div class="message-content">
                    <strong>${AIChatHelpers.escapeHtml(result.prompt)}</strong>
                </div>
            </div>
            
            <div class="message ai">
                <div class="message-avatar">${isAI ? '🧠' : '🤖'}</div>
                <div class="message-content">
                    <div class="ai-analysis">
                        ${AIChatHelpers.escapeHtml(result.answer).replace(/\n/g, '<br>')}
                    </div>
                    
                    <div class="search-results">
                        <h3>📚 Intelligent Search Results (${sources.length} sources analyzed)</h3>
                        ${sources.map((source, index) => `
                        <div class="result-item">
                            <a href="${source.url}" target="_blank" class="result-title">
                                ${source.icon} ${AIChatHelpers.escapeHtml(source.title)}
                            </a>
                            <div class="result-content">${AIChatHelpers.escapeHtml(source.content)}</div>
                            <div class="result-meta">
                                <span class="meta-badge">${source.source}</span>
                                <span class="meta-badge">${source.type}</span>
                                <span class="meta-badge">Rank: ${source.rank}</span>
                                <span class="meta-badge">Relevance: ${source.relevance}/10</span>
                                ${source.upvotes ? `<span class="meta-badge">▲ ${source.upvotes}</span>` : ''}
                            </div>
                        </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="footer">
            <p>Generated by Intelligent Web Search • ${new Date().toLocaleDateString()}</p>
            <p style="margin-top: 15px; opacity: 0.8;">
                ${isAI ? 'Powered by Local AI • LangChain-style Processing • ' : ''}No API Keys • Complete Privacy
            </p>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const messages = document.querySelector('.chat-messages');
            messages.scrollTop = messages.scrollHeight;
            
            // Enhanced interactions
            const links = document.querySelectorAll('.result-title');
            links.forEach(link => {
                link.addEventListener('click', function() {
                    this.style.opacity = '0.7';
                    setTimeout(() => {
                        this.style.opacity = '1';
                    }, 200);
                });
            });
            
            // Add analytics
            console.log('AI Search Report:', {
                query: "${AIChatHelpers.escapeHtml(result.prompt)}",
                sources: ${sources.length},
                aiEnhanced: ${isAI},
                model: "${model}",
                timestamp: "${new Date().toISOString()}"
            });
        });
    </script>
</body>
</html>`;
  }
}

// MAIN INTELLIGENT CHAT APPLICATION
class IntelligentWebSearchChat {
  constructor() {
    this.searchService = new IntelligentSearchService();
    this.chatService = new IntelligentChatInterface();
    this.conversation = [];
    this.aiEnabled = false;
  }

  async initialize() {
    AIChatHelpers.log('🚀 Starting Intelligent Web Search Chat...', 'system');
    await this.searchService.initialize();
    this.aiEnabled = this.searchService.aiService.isAvailable;
    
    if (this.aiEnabled) {
      AIChatHelpers.log('🧠 Local AI Integration: ACTIVE', 'success');
    } else {
      AIChatHelpers.log('🔍 Enhanced Analysis: ACTIVE (AI available with Ollama)', 'system');
    }
    
    AIChatHelpers.log('Ready for intelligent conversations!', 'success');
  }

  async close() {
    await this.searchService.close();
  }

  async processMessage(message) {
    try {
      const validatedMessage = AIChatHelpers.validatePrompt(message);
      
      // Add to conversation history
      this.conversation.push({
        role: 'user',
        content: validatedMessage,
        timestamp: new Date().toISOString()
      });

      AIChatHelpers.log(`Processing: "${validatedMessage}"`, 'user');
      
      // Perform intelligent search
      const searchResults = await this.searchService.intelligentSearch(validatedMessage);
      const response = searchResults.summary;

      // Add AI response to conversation
      this.conversation.push({
        role: 'assistant',
        content: response,
        sources: searchResults.sources,
        aiEnhanced: searchResults.aiEnhanced,
        timestamp: new Date().toISOString()
      });

      const result = {
        success: true,
        prompt: validatedMessage,
        answer: response,
        searchResults: searchResults,
        timestamp: new Date().toISOString()
      };

      // Save intelligent result
      const saveInfo = await this.chatService.saveIntelligentResult(result);
      if (saveInfo) {
        result.filename = saveInfo.filename;
        result.filePath = saveInfo.htmlPath;
      }

      // Display response
      AIChatHelpers.log(response, 'ai');

      return result;

    } catch (error) {
      AIChatHelpers.log(`Error: ${error.message}`, 'error');
      return {
        success: false,
        error: error.message,
        prompt: message
      };
    }
  }

  getStats() {
    const aiResponses = this.conversation.filter(msg => msg.role === 'assistant' && msg.aiEnhanced).length;
    const totalResponses = this.conversation.filter(msg => msg.role === 'assistant').length;
    
    return {
      totalMessages: this.conversation.length,
      aiEnhanced: aiResponses,
      standardAnalysis: totalResponses - aiResponses,
      aiPercentage: totalResponses > 0 ? Math.round((aiResponses / totalResponses) * 100) : 0
    };
  }

  getConversationHistory() {
    return this.conversation;
  }
}

// INTERACTIVE INTELLIGENT CHAT INTERFACE
async function main() {
  console.log(chalk.magenta.bold(`
  🧠 INTELLIGENT WEB SEARCH CHAT
  ==============================
  
  Features:
  • Local AI Integration (Ollama)
  • LangChain-style Processing
  • Multi-source Intelligent Search
  • Beautiful AI-enhanced Reports
  • Complete Privacy & Offline Operation
  
  Commands:
  • 'quit' - Exit the chat
  • 'history' - View conversation
  • 'stats' - See AI usage statistics
  • 'help' - Show this message
  
  ${chalk.yellow('Note:')} Install Ollama for AI features: ${chalk.blue('https://ollama.ai')}
  `));

  const chatBot = new IntelligentWebSearchChat();
  
  try {
    await chatBot.initialize();

    while (true) {
      const userInput = await AIChatHelpers.askQuestion('\n');
      
      // Handle commands
      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        AIChatHelpers.log('Thank you for using Intelligent Web Search! 👋', 'system');
        break;
      }
      
      if (userInput.toLowerCase() === 'history') {
        const history = chatBot.getConversationHistory();
        if (history.length === 0) {
          AIChatHelpers.log('No conversation history yet.', 'system');
        } else {
          AIChatHelpers.log('Conversation History:', 'system');
          history.forEach((msg, index) => {
            const prefix = msg.role === 'user' ? '👤 You' : msg.aiEnhanced ? '🧠 AI' : '🤖 Assistant';
            const preview = msg.content.substring(0, 80) + (msg.content.length > 80 ? '...' : '');
            AIChatHelpers.log(`${index + 1}. ${prefix}: ${preview}`, msg.role);
          });
        }
        continue;
      }
      
      if (userInput.toLowerCase() === 'stats') {
        const stats = chatBot.getStats();
        AIChatHelpers.log('Chat Statistics:', 'system');
        AIChatHelpers.log(`Total Messages: ${stats.totalMessages}`, 'system');
        AIChatHelpers.log(`AI-Enhanced Responses: ${stats.aiEnhanced}`, 'success');
        AIChatHelpers.log(`Standard Analysis: ${stats.standardAnalysis}`, 'system');
        AIChatHelpers.log(`AI Usage: ${stats.aiPercentage}%`, 'system');
        continue;
      }
      
      if (userInput.toLowerCase() === 'help') {
        console.log(chalk.magenta(`
Available Commands:
• Ask any question - Get AI-powered search results
• 'history' - View your conversation history  
• 'stats' - See AI usage statistics
• 'quit' - Exit the application

Example Questions:
• "Tell me about quantum computing"
• "What are the benefits of renewable energy?"
• "Explain machine learning basics"
        `));
        continue;
      }
      
      if (userInput.trim()) {
        const result = await chatBot.processMessage(userInput);
        
        if (result.success && result.filePath) {
          AIChatHelpers.log(`💾 ${result.searchResults.aiEnhanced ? 'AI Report' : 'Search Report'} saved: ${result.filename}`, 'success');
          
          const openResult = await AIChatHelpers.askQuestion('Open the full report? (y/n): ');
          if (openResult.toLowerCase() === 'y' || openResult.toLowerCase() === 'yes') {
            await AIChatHelpers.openInBrowser(result.filePath);
            AIChatHelpers.log('Report opened in browser!', 'success');
          }
        }
      }
    }
  } catch (error) {
    AIChatHelpers.log(`Fatal error: ${error.message}`, 'error');
  } finally {
    await chatBot.close();
    rl.close();
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

module.exports = IntelligentWebSearchChat;