'use client';

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';

export default function Home() {
  // --- 1. Global Setup & State ---
  const [apiKey, setApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState(['gemini-2.5-flash', 'gemini-2.5-pro']);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [activeTab, setActiveTab] = useState('setup'); 
  const [loadingModels, setLoadingModels] = useState(false);
  
  // Basic & Advanced Configuration
  const [topic, setTopic] = useState('');
  const [activeNotebook, setActiveNotebook] = useState('Default Notebook');
  const [numQuestions, setNumQuestions] = useState(5);
  const [mcqPercentage, setMcqPercentage] = useState(100);
  const [difficulty, setDifficulty] = useState('Intermediate');
  const [distractorDifficulty, setDistractorDifficulty] = useState('Challenging');
  const [useSearchGrounding, setUseSearchGrounding] = useState(false);

  // External Imports
  const [pastedJson, setPastedJson] = useState('');
  const [showExternalGradeInput, setShowExternalGradeInput] = useState(false);
  const [externalGradeJson, setExternalGradeJson] = useState('');

  // App Mechanics
  const [quizHistory, setQuizHistory] = useState([]);
  const [currentQuizId, setCurrentQuizId] = useState(null);
  const [quizData, setQuizData] = useState(null);
  const [userAnswers, setUserAnswers] = useState({}); 
  const [isComplete, setIsComplete] = useState(false);
  const [gradingFeedback, setGradingFeedback] = useState(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState({}); 
  
  // History Editing Mechanics
  const [editNotebookId, setEditNotebookId] = useState(null);
  const [editNotebookName, setEditNotebookName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exportCopied, setExportCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  // Derived Values
  const mcqCount = Math.round((mcqPercentage / 100) * numQuestions);
  const openCount = numQuestions - mcqCount;
  const optionLetters = ['A', 'B', 'C', 'D'];

  const uniqueNotebooks = [...new Set(quizHistory.map(q => q.notebook || 'Uncategorized').filter(nb => nb !== 'Uncategorized'))];
  if (!uniqueNotebooks.includes('Default Notebook')) uniqueNotebooks.unshift('Default Notebook');

  // --- 2. Local Storage Management ---
  useEffect(() => {
    const savedKey = localStorage.getItem('byok_gemini_api_key');
    if (savedKey) setApiKey(savedKey);

    const savedHistory = localStorage.getItem('byok_quiz_history');
    if (savedHistory) setQuizHistory(JSON.parse(savedHistory));

    const savedModels = localStorage.getItem('byok_available_models');
    if (savedModels) {
      const parsedModels = JSON.parse(savedModels);
      setAvailableModels(parsedModels);
      if (parsedModels.length > 0) setSelectedModel(parsedModels[0]);
    }
  }, []);

  const handleApiKeyChange = (val) => {
    setApiKey(val);
    localStorage.setItem('byok_gemini_api_key', val);
  };

  const saveToHistory = (quizState) => {
    setQuizHistory(prev => {
      const existingIndex = prev.findIndex(q => q.id === quizState.id);
      let updatedHistory;
      if (existingIndex >= 0) {
        updatedHistory = [...prev];
        updatedHistory[existingIndex] = quizState;
      } else {
        updatedHistory = [quizState, ...prev];
      }
      localStorage.setItem('byok_quiz_history', JSON.stringify(updatedHistory));
      return updatedHistory;
    });
  };

  const deleteQuizFromHistory = (id, e) => {
    e.stopPropagation(); 
    const updated = quizHistory.filter(q => q.id !== id);
    setQuizHistory(updated);
    localStorage.setItem('byok_quiz_history', JSON.stringify(updated));
    if (currentQuizId === id) resetWorkspace();
  };

  const startNotebookEdit = (id, currentNotebook, e) => {
    e.stopPropagation();
    setEditNotebookId(id);
    setEditNotebookName(currentNotebook === 'Uncategorized' ? 'Default Notebook' : currentNotebook);
  };

  const saveNotebookMove = (id, e) => {
    e.stopPropagation();
    setQuizHistory(prev => {
      const updated = prev.map(q => q.id === id ? { ...q, notebook: editNotebookName.trim() || 'Uncategorized' } : q);
      localStorage.setItem('byok_quiz_history', JSON.stringify(updated));
      return updated;
    });
    setEditNotebookId(null);
  };

  const deleteNotebook = (notebookName, e) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete the notebook "${notebookName}" and ALL its quizzes?`)) return;
    
    const updated = quizHistory.filter(q => q.notebook !== notebookName);
    setQuizHistory(updated);
    localStorage.setItem('byok_quiz_history', JSON.stringify(updated));
    
    const currentQuiz = quizHistory.find(q => q.id === currentQuizId);
    if (currentQuiz && currentQuiz.notebook === notebookName) resetWorkspace();
  };

  const resetWorkspace = () => {
    setQuizData(null);
    setCurrentQuizId(null);
    setUserAnswers({});
    setIsComplete(false);
    setGradingFeedback(null);
    setShowExternalGradeInput(false);
    setExpandedAnalysis({});
  };

  const calculateAutoExpanded = (data, answers) => {
    const autoExpand = {};
    data.forEach((q, idx) => {
      if (q.type === 'multiple-choice' && answers[idx]) {
        const oIdx = q.options.indexOf(answers[idx]);
        if (oIdx !== -1) autoExpand[`${idx}-${oIdx}`] = true;
      }
    });
    return autoExpand;
  };

  // --- 3. Dynamic Model Fetching ---
  const fetchAvailableModels = async () => {
    if (!apiKey) { setError("Please enter your API key to fetch models."); return; }
    setLoadingModels(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await res.json();
      
      if (data.models) {
        let textModels = data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'));
        textModels = textModels.filter(m => {
          const name = m.name.toLowerCase();
          return !name.includes('vision') && !name.includes('audio') && !name.includes('embedding') && !name.includes('tts');
        });

        const cleanModelNames = textModels.map(m => m.name.replace('models/', ''));
        if (cleanModelNames.length > 0) {
          setAvailableModels(cleanModelNames);
          localStorage.setItem('byok_available_models', JSON.stringify(cleanModelNames));
          const defaultModel = cleanModelNames.find(m => m.includes('flash')) || cleanModelNames[0];
          setSelectedModel(defaultModel);
        }
      } else if (data.error) { throw new Error(data.error.message); }
    } catch (err) {
      console.error(err); setError(`Failed to fetch models: ${err.message}`);
    } finally {
      setLoadingModels(false);
    }
  };

  // --- 4. Adaptive Learning Tag Engine ---
  const getAvoidanceTags = () => {
    const correctTags = quizHistory
      .filter(q => q.notebook === activeNotebook && q.isComplete && q.feedback)
      .flatMap(q => {
        return q.data.filter((question, idx) => {
          const evalData = q.feedback.evaluations[idx];
          return evalData && evalData.isCorrect;
        }).map(question => question.conceptTag);
      })
      .filter(tag => tag); 

    const uniqueTags = [...new Set(correctTags)];
    return uniqueTags;
  };

  const buildSystemPromptInstructions = (avoidanceTags) => {
    let prompt = `Generate a custom study quiz JSON array about: "${topic}".
    Total questions: ${numQuestions} (Difficulty: ${difficulty}).
    Multiple Choice count: ${mcqCount} (Distractor difficulty: ${distractorDifficulty}).
    Open Ended count: ${openCount}.\n\n`;

    if (avoidanceTags.length > 0) {
      prompt += `CRITICAL AVOIDANCE INSTRUCTION: The user has already mastered specific granular concepts matching these tags. DO NOT generate identical concept questions containing these strings:\n[${avoidanceTags.join(', ')}]\n\n`;
    }
    
    prompt += `CRITICAL SCHEMA REQUIREMENT: You must return a valid, raw JSON array matching this strict schema structure:
    [
      {
        "type": "multiple-choice",
        "question": "The question string",
        "conceptTag": "A scenario-based descriptive tag that embeds the concept and the correct answer explicitly (e.g., 'European History: WWII Normandy Landings - Answer: Operation Overlord' or 'Biology: Cellular Respiration ATP Production - Answer: Mitochondria'). This forms an ultra-distinct fingerprint to bypass collision issues safely.",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correctAnswer": "The exact string match of the correct option",
        "explanations": [
          "Detailed explanation why Option A is correct/incorrect",
          "Detailed explanation why Option B is correct/incorrect",
          "Detailed explanation why Option C is correct/incorrect",
          "Detailed explanation why Option D is correct/incorrect"
        ]
      },
      {
        "type": "open-ended",
        "question": "The open question string",
        "conceptTag": "A scenario-based descriptive tag incorporating evaluated grading metrics",
        "options": [],
        "correctAnswer": "Rubric or grading criteria for marking this question response.",
        "explanations": []
      }
    ]`;
    return prompt;
  };

  const copyExternalPrompt = () => {
    if (!topic) { setError("Please enter a topic first to populate the prompt template."); return; }
    navigator.clipboard.writeText(buildSystemPromptInstructions(getAvoidanceTags()));
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 3000);
  };

  const importExternalJson = () => {
    setError(null);
    try {
      if (!pastedJson.trim()) throw new Error("Text area is blank.");
      const parsed = JSON.parse(pastedJson.trim());
      if (!Array.isArray(parsed)) throw new Error("JSON must be a top-level array.");

      const verifiedQuiz = {
        id: Date.now().toString(),
        topic: topic || "Imported Quiz",
        notebook: activeNotebook,
        date: new Date().toLocaleDateString(),
        data: parsed,
        answers: {},
        isComplete: false,
        feedback: null
      };

      setQuizData(verifiedQuiz.data);
      setUserAnswers({});
      setCurrentQuizId(verifiedQuiz.id);
      saveToHistory(verifiedQuiz);
      setPastedJson('');
      setExpandedAnalysis({});
      setActiveTab('workspace');
    } catch (err) { setError(`Import failed: Check structural syntax. (${err.message})`); }
  };

  // --- 5. Native In-App Quiz Generation Logic ---
  const generateQuiz = async () => {
    if (!apiKey) { setError("API key required. Check Settings tab."); return; }
    if (!topic) { setError("Please enter a topic."); return; }

    setLoading(true); setError(null); resetWorkspace();

    try {
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const avoidanceTags = getAvoidanceTags();
      const requestConfig = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, description: "'multiple-choice' or 'open-ended'" },
              question: { type: Type.STRING },
              conceptTag: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
              explanations: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["type", "question", "conceptTag", "options", "correctAnswer", "explanations"]
          }
        }
      };

      if (useSearchGrounding) requestConfig.tools = [{ googleSearch: {} }];

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: buildSystemPromptInstructions(avoidanceTags),
        config: requestConfig
      });

      const parsedQuestions = JSON.parse(response.text);
      const newQuiz = {
        id: Date.now().toString(), topic, notebook: activeNotebook, date: new Date().toLocaleDateString(),
        data: parsedQuestions, answers: {}, isComplete: false, feedback: null
      };

      setQuizData(newQuiz.data); setUserAnswers({}); setCurrentQuizId(newQuiz.id);
      saveToHistory(newQuiz); setActiveTab('workspace');

    } catch (err) {
      console.error(err); setError("Failed to generate. Check parameters or API key.");
    } finally {
      setLoading(false);
    }
  };

  // --- 6. Interactivity & Grading Engine ---
  const updateAnswer = (qIdx, value) => {
    if (isComplete) return; 
    const newAnswers = { ...userAnswers, [qIdx]: value };
    setUserAnswers(newAnswers);
    
    if (currentQuizId) {
      saveToHistory({
        id: currentQuizId, topic, notebook: activeNotebook, date: new Date().toLocaleDateString(),
        data: quizData, answers: newAnswers, isComplete, feedback: gradingFeedback
      });
    }
  };

  const toggleAnalysis = (qIdx, oIdx) => {
    const key = `${qIdx}-${oIdx}`;
    setExpandedAnalysis(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const loadQuizFromHistory = (quiz) => {
    setTopic(quiz.topic); setQuizData(quiz.data); setUserAnswers(quiz.answers || {});
    setCurrentQuizId(quiz.id); setIsComplete(quiz.isComplete); setGradingFeedback(quiz.feedback);
    setActiveNotebook(quiz.notebook || 'Uncategorized'); // Ensures saving changes doesn't lose the notebook state
    setShowExternalGradeInput(false); 
    setExpandedAnalysis(quiz.isComplete ? calculateAutoExpanded(quiz.data, quiz.answers || {}) : {});
    setActiveTab('workspace');
  };

  const copyQuizForExternalGrading = () => {
    if (!quizData) return;
    let exportString = `I have taken a quiz. Please act as a strict, objective grader. Review my answers against the reference keys provided.\n\n`;
    exportString += `### QUIZ DATA EXPORT: ${topic}\n\n`;
    
    quizData.forEach((q, idx) => {
      exportString += `Q${idx + 1}: ${q.question}\n`;
      if (q.type === 'multiple-choice') {
        const ansIndex = q.options.indexOf(userAnswers[idx]);
        const userSelection = ansIndex !== -1 ? q.options[ansIndex] : "(No Answer Provided)";
        exportString += `User Selected: ${userSelection}\n`;
      } else {
        exportString += `User Answer: ${userAnswers[idx] || "(No Answer Provided)"}\n`;
      }
      exportString += `Reference Key: ${q.correctAnswer}\n\n`;
    });

    exportString += `---
    CRITICAL INSTRUCTION: You MUST output your grading evaluation as a raw, valid JSON object exactly matching this schema (do not include markdown blocks):
    {
      "totalScorePercentage": 85,
      "evaluations": [
        {
          "isCorrect": true,
          "feedback": "Short explanation of why question 1 is right or wrong."
        }
      ]
    }`;

    navigator.clipboard.writeText(exportString);
    setExportCopied(true);
    setTimeout(() => setExportCopied(false), 3000);
  };

  const applyExternalGradeJson = () => {
    setError(null);
    try {
      if (!externalGradeJson.trim()) throw new Error("Grade payload is empty.");
      const parsed = JSON.parse(externalGradeJson.trim());
      
      if (parsed.totalScorePercentage === undefined || !Array.isArray(parsed.evaluations)) {
        throw new Error("Invalid grading schema.");
      }

      setGradingFeedback(parsed);
      setIsComplete(true);
      setShowExternalGradeInput(false);
      setExpandedAnalysis(calculateAutoExpanded(quizData, userAnswers));
      
      saveToHistory({
        id: currentQuizId, topic, notebook: activeNotebook, date: new Date().toLocaleDateString(),
        data: quizData, answers: userAnswers, isComplete: true, feedback: parsed
      });
    } catch(err) { setError(`Failed to apply external grade: ${err.message}`); }
  };

  const gradeInApp = async () => {
    setLoading(true); setError(null);
    const evaluations = [];
    const openEndedPayload = [];

    quizData.forEach((q, idx) => {
      if (q.type === 'multiple-choice') {
        const userSelection = userAnswers[idx] || "";
        const isCorrect = userSelection === q.correctAnswer;
        evaluations[idx] = { isCorrect, feedback: isCorrect ? "Match." : "Incorrect." };
      } else {
        openEndedPayload.push({ originalIndex: idx, question: q.question, expected: q.correctAnswer, userProvided: userAnswers[idx] || "No answer provided" });
      }
    });

    if (openEndedPayload.length > 0) {
      if (!apiKey) { setError("API key required to evaluate open responses."); setLoading(false); return; }
      try {
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: `Evaluate these answers strictly: ${JSON.stringify(openEndedPayload)}`,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  isCorrect: { type: Type.BOOLEAN },
                  feedback: { type: Type.STRING }
                },
                required: ["isCorrect", "feedback"]
              }
            }
          }
        });
        const llmFeedback = JSON.parse(response.text);
        openEndedPayload.forEach((item, i) => { evaluations[item.originalIndex] = llmFeedback[i]; });
      } catch (err) {
        console.error(err); setError("Grading run failed on open-ended logic layers."); setLoading(false); return;
      }
    }

    const correctCount = evaluations.filter(e => e && e.isCorrect).length;
    const totalScorePercentage = Math.round((correctCount / quizData.length) * 100);
    const finalFeedbackData = { totalScorePercentage, evaluations };

    setGradingFeedback(finalFeedbackData);
    setIsComplete(true);
    setExpandedAnalysis(calculateAutoExpanded(quizData, userAnswers));
    
    saveToHistory({
      id: currentQuizId, topic, notebook: activeNotebook, date: new Date().toLocaleDateString(),
      data: quizData, answers: userAnswers, isComplete: true, feedback: finalFeedbackData
    });
    setLoading(false);
  };

  const groupedHistory = quizHistory.reduce((acc, quiz) => {
    const nb = quiz.notebook || 'Uncategorized';
    if (!acc[nb]) acc[nb] = [];
    acc[nb].push(quiz);
    return acc;
  }, {});

  // --- Render Helpers ---
  const NavButton = ({ tab, label }) => (
    <button 
      onClick={() => setActiveTab(tab)} 
      style={{ 
        flex: 1, padding: '12px 10px', 
        background: activeTab === tab ? '#000' : '#fff', color: activeTab === tab ? '#fff' : '#000',
        border: '2px solid black', boxSizing: 'border-box',
        cursor: 'pointer', fontWeight: 'bold', textAlign: 'center', fontFamily: 'monospace'
      }}
    >
      {label}
    </button>
  );

  return (
    <main style={{ width: '100%', maxWidth: '800px', margin: '40px auto', padding: '20px', fontFamily: 'monospace', backgroundColor: '#ffffff', color: '#000000', minHeight: '100vh', boxSizing: 'border-box' }}>
      <h1 style={{ textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '3px solid black', paddingBottom: '10px' }}>
        BYOK Quiz Engine
      </h1>
      
      <div style={{ display: 'flex', borderBottom: '2px solid black', marginBottom: '20px', gap: '5px' }}>
        <NavButton tab="setup" label="[01] Settings" />
        <NavButton tab="generate" label="[02] Generator" />
        <NavButton tab="workspace" label="[03] Workspace" />
        <NavButton tab="history" label={`[04] History (${quizHistory.length})`} />
      </div>

      {error && <div style={{ border: '2px dashed red', backgroundColor: '#fff0f0', color: '#d00000', padding: '15px', marginBottom: '20px', fontWeight: 'bold' }}>[ERR] {error}</div>}

      {/* --- TAB: SETUP --- */}
      {activeTab === 'setup' && (
        <div style={{ border: '2px solid black', padding: '20px', backgroundColor: '#f9f9f9', color: '#000' }}>
          <h3 style={{ marginTop: 0 }}>SYSTEM SETTINGS</h3>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Gemini API Key:</label>
          <input 
            type="password" value={apiKey} onChange={(e) => handleApiKeyChange(e.target.value)}
            style={{ display: 'block', width: '100%', marginBottom: '20px', padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', boxSizing: 'border-box' }}
          />
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>AI Model Selection:</label>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <select 
              value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
              style={{ flex: 1, padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
            >
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <button 
              onClick={fetchAvailableModels} disabled={loadingModels || !apiKey}
              style={{ background: '#000', color: '#fff', padding: '0 15px', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}
            >
              {loadingModels ? 'FETCHING...' : 'FETCH MODELS'}
            </button>
          </div>
        </div>
      )}

      {/* --- TAB: GENERATOR --- */}
      {activeTab === 'generate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ border: '2px solid black', padding: '20px', backgroundColor: '#f9f9f9', color: '#000' }}>
            <h3 style={{ marginTop: 0 }}>NATIVE IN-APP GENERATOR</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Target Topic:</label>
                <input 
                  type="text" placeholder="e.g., AWS S3" value={topic} onChange={(e) => setTopic(e.target.value)}
                  style={{ display: 'block', width: '100%', padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Assign to Notebook:</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <select 
                    value={uniqueNotebooks.includes(activeNotebook) ? activeNotebook : 'Custom'} 
                    onChange={(e) => {
                      if (e.target.value !== 'Custom') setActiveNotebook(e.target.value);
                      else setActiveNotebook(''); 
                    }}
                    style={{ flex: 1, padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                  >
                    {uniqueNotebooks.map(nb => <option key={nb} value={nb}>{nb}</option>)}
                    <option value="Custom">[+] Create New Notebook...</option>
                  </select>
                  
                  {!uniqueNotebooks.includes(activeNotebook) && (
                    <input 
                      type="text" 
                      placeholder="Type new notebook name..." 
                      value={activeNotebook} 
                      onChange={(e) => setActiveNotebook(e.target.value)}
                      style={{ flex: 1, padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', borderTop: '1px dashed black', paddingTop: '15px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Total Questions: {numQuestions}</label>
                <input 
                  type="number" min="1" max="20" value={numQuestions} onChange={(e) => setNumQuestions(parseInt(e.target.value) || 5)}
                  style={{ width: '100%', padding: '8px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Format Split: {mcqPercentage}% MCQ</label>
                <input type="range" min="0" max="100" step="1" value={mcqPercentage} onChange={(e) => setMcqPercentage(parseInt(e.target.value))} style={{ width: '100%', accentColor: 'black' }} />
                <p style={{ fontSize: '12px', marginTop: '5px' }}>Result: <strong>{mcqCount}</strong> MCQ / <strong>{openCount}</strong> Open</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', borderTop: '1px dashed black', paddingTop: '15px', marginTop: '15px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Topic Difficulty:</label>
                <select 
                  value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                >
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                  <option value="Expert">Expert</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Distractor Difficulty:</label>
                <select 
                  value={distractorDifficulty} onChange={(e) => setDistractorDifficulty(e.target.value)}
                  style={{ width: '100%', padding: '8px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
                >
                  <option value="Standard">Standard</option>
                  <option value="Challenging">Challenging</option>
                  <option value="Trick Questions">Trick Questions</option>
                </select>
              </div>
            </div>
            
            <button 
              onClick={generateQuiz} disabled={loading} 
              style={{ width: '100%', background: '#000', color: '#fff', padding: '15px', border: '2px solid black', marginTop: '20px', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}
            >
              {loading ? 'GENERATING...' : 'RUN GENERATION ENGINE'}
            </button>
          </div>

          <div style={{ border: '2px solid black', padding: '20px', backgroundColor: '#fff' }}>
            <h3 style={{ marginTop: 0 }}>EXTERNAL LLM ENGINE IMPORT</h3>
            <button 
              onClick={copyExternalPrompt}
              style={{ background: '#fff', color: '#000', padding: '10px', width: '100%', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', marginBottom: '15px', fontFamily: 'monospace', boxSizing: 'border-box' }}
            >
              {promptCopied ? 'PROMPT TEMPLATE COPIED TO CLIPBOARD!' : 'COPY SCHEMA SYSTEM PROMPT TEMPLATE'}
            </button>
            <textarea 
              rows={4} value={pastedJson} onChange={(e) => setPastedJson(e.target.value)}
              placeholder="Paste generated raw JSON block structure here..."
              style={{ width: '100%', padding: '10px', border: '2px solid black', fontFamily: 'monospace', backgroundColor: '#fff', color: '#000', boxSizing: 'border-box', marginBottom: '10px' }}
            />
            <button 
              onClick={importExternalJson}
              style={{ background: '#000', color: '#fff', padding: '12px', width: '100%', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}
            >
              PARSE & CONSTRUCT WORKSPACE
            </button>
          </div>
        </div>
      )}

      {/* --- TAB: WORKSPACE (ACTIVE QUIZ) --- */}
      {activeTab === 'workspace' && quizData && (
        <div style={{ border: '2px solid black', padding: '20px', backgroundColor: '#fff', color: '#000' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid black', paddingBottom: '10px', marginBottom: '20px' }}>
            <div>
               <h3 style={{ margin: 0 }}>{topic.toUpperCase()}</h3>
               <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Notebook: {quizData.notebook || activeNotebook}</span>
            </div>
            {isComplete && <span style={{ background: 'black', color: 'white', padding: '5px 10px' }}>LOCKED / COMPLETE</span>}
          </div>
          
          {quizData.map((q, idx) => {
            const userIsCorrectMCQ = q.type === 'multiple-choice' && userAnswers[idx] === q.correctAnswer;
            return (
            <div key={idx} style={{ marginBottom: '30px', borderBottom: '1px dashed #ccc', paddingBottom: '20px' }}>
              <p>
                <strong>Q{idx + 1}:</strong> {q.question}
                {isComplete && <span style={{ fontSize: '11px', background: '#eee', padding: '2px 6px', marginLeft: '10px', border: '1px solid #ccc' }}>Tag: {q.conceptTag || 'None'}</span>}
              </p>

              {q.type === 'multiple-choice' && (
                <div style={{ margin: '15px 0' }}>
                  {q.options.map((opt, oIdx) => {
                    const isSelected = userAnswers[idx] === opt;
                    const isCorrectAnswer = opt === q.correctAnswer;
                    const letter = optionLetters[oIdx];
                    
                    let buttonBg = '#ffffff';
                    let buttonText = '#000000';
                    if (isComplete) {
                      if (isCorrectAnswer) {
                        buttonBg = '#e6ffe6'; buttonText = '#006600';
                      } else if (isSelected && !isCorrectAnswer) {
                        buttonBg = '#fff0e6'; buttonText = '#cc5200';
                      } else {
                        buttonBg = '#ffe6e6'; buttonText = '#cc0000';
                      }
                    } else if (isSelected) {
                      buttonBg = '#000000'; buttonText = '#ffffff';
                    }

                    const key = `${idx}-${oIdx}`;
                    const isExpanded = expandedAnalysis[key];
                    const shouldShowExplanation = isComplete && q.explanations && q.explanations[oIdx];

                    return (
                      <div key={oIdx} style={{ marginBottom: '10px' }}>
                        <button
                          onClick={() => isComplete ? toggleAnalysis(idx, oIdx) : updateAnswer(idx, opt)}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left', padding: '12px',
                            border: isSelected && !isComplete ? '3px solid black' : '2px solid black',
                            backgroundColor: buttonBg, color: buttonText, boxSizing: 'border-box',
                            cursor: 'pointer', fontFamily: 'monospace', fontWeight: isSelected || (isComplete && isCorrectAnswer) ? 'bold' : 'normal'
                          }}
                        >
                          <strong>{letter})</strong> {opt} {isComplete && !isCorrectAnswer && <span style={{ float: 'right', fontSize: '11px' }}>{isExpanded ? '[-]' : '[+]'}</span>}
                        </button>
                        
                        {shouldShowExplanation && (isExpanded) && (
                           <div style={{ margin: '0', padding: '10px', fontSize: '12px', border: '2px solid black', borderTop: 'none', backgroundColor: '#fcfcfc', boxSizing: 'border-box' }}>
                             <strong>Analysis:</strong> {q.explanations[oIdx]}
                           </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {q.type === 'open-ended' && (
                <textarea
                  rows={4} disabled={isComplete}
                  value={userAnswers[idx] || ''}
                  onChange={(e) => updateAnswer(idx, e.target.value)}
                  placeholder="Type subjective reasoning matrix answer here..."
                  style={{ width: '100%', padding: '10px', border: '2px solid black', fontFamily: 'monospace', boxSizing: 'border-box', backgroundColor: '#fff', color: '#000' }}
                />
              )}

              {isComplete && q.type === 'open-ended' && (
                <div style={{ marginTop: '10px', padding: '12px', border: '1px solid black', backgroundColor: '#f9f9f9' }}>
                  <p style={{ margin: '0 0 5px 0', fontSize: '13px' }}><strong>Expected Key Requirements:</strong> {q.correctAnswer}</p>
                  {gradingFeedback && gradingFeedback.evaluations[idx] && (
                    <div style={{ marginTop: '5px', color: gradingFeedback.evaluations[idx].isCorrect ? '#006600' : '#cc0000' }}>
                      <strong>{gradingFeedback.evaluations[idx].isCorrect ? '✅ Evaluation Passed' : '❌ Evaluation Failed'}</strong>
                      <p style={{ margin: '3px 0 0 0', fontSize: '12px' }}>{gradingFeedback.evaluations[idx].feedback}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )})}

          {!isComplete && !showExternalGradeInput && (
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={gradeInApp} disabled={loading} style={{ flex: 1, background: '#000', color: '#fff', padding: '15px', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}>
                {loading ? 'RUNNING EVAL ENGINE...' : 'GRADE IN-APP'}
              </button>
              <button onClick={() => { copyQuizForExternalGrading(); setShowExternalGradeInput(true); }} style={{ flex: 1, background: '#fff', color: '#000', padding: '15px', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}>
                {exportCopied ? 'PAYLOAD COPIED!' : 'EXPORT FOR EXTERNAL GRADING'}
              </button>
            </div>
          )}

          {!isComplete && showExternalGradeInput && (
             <div style={{ marginTop: '20px', padding: '15px', border: '2px dashed black', backgroundColor: '#f9f9f9' }}>
               <h4 style={{ margin: '0 0 10px 0' }}>PASTE EXTERNAL EVALUATION JSON</h4>
               <textarea 
                 rows={4} value={externalGradeJson} onChange={(e) => setExternalGradeJson(e.target.value)}
                 placeholder='Paste the JSON grading response here...'
                 style={{ width: '100%', padding: '10px', border: '2px solid black', fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: '10px' }}
               />
               <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={applyExternalGradeJson} style={{ flex: 1, background: '#000', color: '#fff', padding: '12px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}>
                    APPLY GRADES
                  </button>
                  <button onClick={() => setShowExternalGradeInput(false)} style={{ flex: 1, background: '#fff', color: '#000', padding: '12px', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', boxSizing: 'border-box' }}>
                    CANCEL
                  </button>
               </div>
             </div>
          )}
          
          {isComplete && gradingFeedback && (
            <div style={{ marginTop: '20px', padding: '20px', border: '2px solid black', textAlign: 'center', fontSize: '24px', fontWeight: 'bold', backgroundColor: '#f9f9f9', boxSizing: 'border-box' }}>
              FINAL SCORE: {gradingFeedback.totalScorePercentage}%
            </div>
          )}
        </div>
      )}

      {/* --- TAB: HISTORY --- */}
      {activeTab === 'history' && (
        <div style={{ backgroundColor: '#fff', color: '#000' }}>
          
          {/* Section: Create / Add Notebook Retroactively */}
          <div style={{ border: '2px solid black', padding: '20px', marginBottom: '20px', backgroundColor: '#fafafa' }}>
            <h3 style={{ marginTop: 0 }}>PROACTIVELY ASSIGN / MANAGE NOTEBOOKS</h3>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Create or select a notebook from existing books:</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <select 
                value={activeNotebook} 
                onChange={(e) => setActiveNotebook(e.target.value)}
                style={{ flex: 1, padding: '10px', border: '2px solid black', backgroundColor: '#fff', color: '#000', fontFamily: 'monospace', boxSizing: 'border-box' }}
              >
                {uniqueNotebooks.map(nb => <option key={nb} value={nb}>{nb}</option>)}
              </select>
            </div>
            <p style={{ fontSize: '12px', color: '#555' }}>*Select an active notebook here to scope generated quizzes or locate retroactively.</p>
          </div>

          {Object.keys(groupedHistory).length === 0 ? (
            <div style={{ border: '2px solid black', padding: '20px' }}>
              <p style={{ margin: 0 }}>No indexes recorded inside the browser storage array matrix.</p>
            </div>
          ) : (
            Object.keys(groupedHistory).map(notebookName => (
              <div key={notebookName} style={{ border: '2px solid black', marginBottom: '20px', backgroundColor: '#f9f9f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px', borderBottom: '2px solid black', backgroundColor: '#ececec' }}>
                  <h3 style={{ margin: 0, textTransform: 'uppercase' }}>📁 NOTEBOOK: {notebookName}</h3>
                  {notebookName !== 'Uncategorized' && (
                    <button 
                      onClick={(e) => deleteNotebook(notebookName, e)}
                      style={{ background: '#fff', color: 'red', padding: '6px 12px', border: '2px solid red', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '12px' }}
                    >
                      DELETE NOTEBOOK
                    </button>
                  )}
                </div>
                <div style={{ padding: '15px' }}>
                  {groupedHistory[notebookName].map(q => (
                    <div key={q.id} style={{ display: 'flex', flexDirection: 'column', padding: '12px', border: '2px solid black', marginBottom: '10px', backgroundColor: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>{q.topic}</strong> <br/>
                          <span style={{ fontSize: '12px' }}>{q.date} | {q.data.length} Qs | {q.isComplete ? `Score: ${q.feedback?.totalScorePercentage ?? 'N/A'}%` : 'In Progress'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => loadQuizFromHistory(q)}
                            style={{ background: 'black', color: 'white', padding: '8px 12px', border: '2px solid black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '12px' }}
                          >
                            LOAD
                          </button>
                          
                          {editNotebookId !== q.id && (
                            <button 
                              onClick={(e) => startNotebookEdit(q.id, q.notebook, e)}
                              style={{ background: '#fff', color: '#000', padding: '8px 12px', border: '2px dashed black', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '12px' }}
                              title="Move to another notebook"
                            >
                              MOVE
                            </button>
                          )}

                          <button 
                            onClick={(e) => deleteQuizFromHistory(q.id, e)}
                            style={{ background: '#fff', color: 'red', padding: '8px 12px', border: '2px solid red', cursor: 'pointer', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '12px' }}
                          >
                            DELETE
                          </button>
                        </div>
                      </div>

                      {editNotebookId === q.id && (
                        <div style={{ marginTop: '10px', padding: '10px', borderTop: '1px dashed #ccc', display: 'flex', gap: '10px', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Move to Notebook dropdown:</span>
                          <select 
                            value={editNotebookName} onChange={(e) => setEditNotebookName(e.target.value)}
                            style={{ flex: 1, padding: '5px', border: '2px solid black', fontFamily: 'monospace', backgroundColor: '#fff' }}
                          >
                             {uniqueNotebooks.map(nb => <option key={nb} value={nb}>{nb}</option>)}
                          </select>
                          <button 
                            onClick={(e) => saveNotebookMove(q.id, e)}
                            style={{ background: '#000', color: '#fff', padding: '5px 10px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                          >
                            SAVE
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditNotebookId(null); }}
                            style={{ background: '#fff', color: '#000', padding: '5px 10px', border: '1px solid black', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                          >
                            CANCEL
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}

// Simple helper to bypass lexical letters error check on index rendering safely
const Letters = ['A', 'B', 'C', 'D'];