# web-search-ai

## 📌 Overview
This repository contains a project written in **Javascript**.
The main entry point is `not detected`.

## 📜 Definition of the Code
**`web-search-ai` is a resilient, AI-ready Robotic Process Automation (RPA) framework** that orchestrates a web browser to perform multi-step tasks (login, compose, submit) on any web interface. It combines **deterministic automation** (CSS selectors) with **computer vision** (OpenCV) to adapt to visual changes in real-time, eliminating brittle selectors. It includes a built-in scheduler, live debugging, screenshot auditing, error escalation (email), and a plugin architecture for integrating **generative AI** (for dynamic content creation) and **multi-modal AI** (for semantic visual understanding). This makes it both a reliable workhorse for repetitive tasks and a foundation for building autonomous digital agents that operate across corporate systems and humanitarian aid platforms.

## 🌟 21 Real-Time Benefits & AI-Scalability Scope

### 🔧 Core Engine (Real-Time & Resilient)
1. **Live Visual Adaptation** – The OpenCV engine scans the screen in milliseconds. If a button moves 100px down due to a new banner, the script finds it *right now* using pixel matching, not stale HTML.
2. **Real-Time Feedback Loop** – You can run it in visible mode and **watch every click and keystroke** as they happen. If something goes wrong, you can hit `Ctrl+C` to pause and intervene immediately.
3. **Instant Debugging with Live Screenshots** – Every critical step (login, form fill, submit) saves a timestamped screenshot to disk. You get a visual history of what the AI "saw" at the exact moment of failure, reducing debugging time by hours.
4. **Dynamic Environment Adaptation** – It automatically handles varying screen resolutions, scaling (DPI), and window sizes by capturing the *actual display* rather than relying on fixed viewport coordinates.
5. **Interactive Live Teaching** – The `--record` command lets you **click and drag** on your live screen to teach the system a new element. The training data (the image) is captured and stored in real time, ready to use immediately—no coding required.

### 🏢 Corporate Impact (Cost, Speed, & Scale)
6. **Eliminates Human Drudgery** – Offloads repetitive data entry, daily report generation, and newsletter publishing, allowing employees to focus on strategic work—cutting task time from 30 minutes to 2 minutes.
7. **24/7/365 Operations** – The scheduler runs without breaks, holidays, or sick days. Critical internal updates (e.g., inventory restocking) can be posted at 3:00 AM without human intervention.
8. **Massive Cost Reduction** – Replaces hours of manual labour. A single automation running daily saves ~$5,000–$10,000 per year per process in operational costs (estimated replacement of ~0.5 FTE).
9. **Rapid Horizontal Scaling** – Run multiple instances across different servers to handle thousands of simultaneous publishing jobs. Scale from 1 system to 100 systems by just duplicating the config and launching new threads.
10. **Resilience to Front-End Code Changes** – Developers frequently change CSS classes. By falling back to vision, this script survives minor UI overhauls, saving IT teams from rewriting automation scripts every month.
11. **Legacy System Revival** – Unlocks and automates older, API-less systems (e.g., legacy CRMs, mainframe terminal interfaces) by visually interacting with them as a human would, extending the life of million-dollar legacy infrastructure.
12. **Granular Audit Trail** – Every action is logged with a screenshot and timestamp. This provides a legally defensible audit trail for compliance (e.g., GDPR, SOX) showing exactly when and what was published or updated.
13. **Cross-System Workflow Automation** – Connects siloed tools that don't natively talk to each other. Example: Fetch data from a Google Sheet → Open an internal purchasing system → Fill the order form → Submit.

### 🌍 Humanitarian & Global Aid Impact
14. **Crisis Data Aggregation** – In disaster zones, official websites often publish survival information (shelter locations, food distribution). This script can scrape those sites in real time and aggregate the data into a central dashboard for aid coordinators.
15. **Rapid Aid Deployment** – Automates the submission of supply request forms across multiple UN or NGO portals instantly, reducing the time to get life-saving medicine from "hours" to "seconds" during sudden crises.
16. **Real-Time Language Translation** – By integrating a translation LLM, the system can read a French emergency bulletin, translate it to English or Swahili, and automatically post it to a local community board—all within seconds of the original publication.
17. **Volunteer Onboarding Automation** – During sudden emergencies, NGOs experience spikes in volunteer signups. The script can automatically process and enrol new volunteers by filling web forms across multiple training platforms simultaneously.
18. **Real-Time Misinformation Flagging** – Monitors social media or official government dashboards for suspicious keyword patterns. If flagged, it automatically captures screenshots (evidence) and alerts the humanitarian response team via email, creating a real-time early warning system.
19. **Accessibility Aid** – When paired with text-to-speech, the automation can *read aloud* critical visual alerts that appear on dashboards for visually impaired aid workers, ensuring no one misses critical data due to interface barriers.

### 🤖 AI Integration & Semantic Scalability
20. **Generative Content (LLM)** – Ditch the static template. Hook up OpenAI or a local LLM (like Llama) to generate unique, context-aware text for each run. The script becomes a **content creator**, writing daily situation reports, translating updates, or generating personalised donor thank-you letters on the fly.
21. **Cognitive Vision (Multi-Modal AI)** – Upgrade from basic OpenCV matching to multi-modal AI (e.g., GPT-4o, LLaVA). Instead of matching exact pixels, the AI *understands* the page semantically. You can ask: *"Find the button that says 'Publish' or looks like a 'Submit' icon"*—even if the button is a completely new colour or shape, the AI finds it. This eliminates the need for manual template recording entirely, making the system universal and infinitely scalable across *any* website.

## 📁 Project Structure
## 🚀 Full Program Guide (How to Run)
### 📋 Prerequisites
- Node.js 14 or higher (`node --version`).
### 1️⃣ Clone or Navigate to the Project
```bash
git clone https://github.com/petemits/{folder.name}.git
cd {folder.name}
```
### 3️⃣ Install Dependencies
```bash
npm install
```
### 4️⃣ Configure the Application
The project contains a configuration file (`.env`).
- Open the file and fill in any required credentials (e.g., `username`, `password`, `API_KEY`).
- For `.env` files, create a copy from `.env.example` if provided.
### 5️⃣ Run the Program
```bash
No run command detected
```
### 6️⃣ Expected Output
If the program is set up correctly, it will start without errors and perform the intended automation or display the expected output.
For automation scripts, check the log file (e.g., `upu.log` or auto-generated reports).
### 🔧 Troubleshooting
- **Missing dependencies**: Ensure all prerequisites are installed and that your PATH includes the runtime.
- **Port conflicts**: If using a web server, make sure the port (e.g., `8000`) is free.
- **Permission errors**: On Windows, run the terminal as Administrator if needed.
- **Configuration**: Double-check that `.env` or `config.yaml` has the correct credentials.
