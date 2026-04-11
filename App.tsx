import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type, ThinkingLevel, Modality } from '@google/genai';
import { auth, db, signIn, logOut } from './firebase';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { 
  MessageSquare, Image as ImageIcon, Video, Mic, Search, MapPin, Brain, 
  Zap, PlayCircle, LogOut, Loader2, Send, Paperclip, X, Volume2, Sparkles,
  Camera, FileAudio, FileVideo, User
} from 'lucide-react';

import { LiveAudioSession } from './components/LiveAudioSession';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const App = () => {
  const [user, setUser] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  
  // Toggles
  const [useSearch, setUseSearch] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [useThinking, setUseThinking] = useState(false);
  const [useFast, setUseFast] = useState(false);
  const [mode, setMode] = useState<'chat' | 'image_gen' | 'video_gen' | 'tts' | 'live'>('chat');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'messages'), orderBy('timestamp', 'asc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
      
      newFiles.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && files.length === 0) return;
    if (!user) return;

    const userText = input;
    setInput('');
    setIsTyping(true);

    try {
      // Save user message
      await addDoc(collection(db, 'users', user.uid, 'messages'), {
        uid: user.uid,
        role: 'user',
        text: userText,
        timestamp: Date.now(),
        hasFiles: files.length > 0
      });

      let responseText = '';
      let responseMedia = null;

      if (mode === 'image_gen') {
        // Image Generation
        const res = await ai.models.generateContent({
          model: 'gemini-3.1-flash-image-preview',
          contents: userText,
          config: {
            imageConfig: { aspectRatio: "16:9", imageSize: "1K" }
          }
        });
        const imgPart = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (imgPart?.inlineData) {
          responseMedia = `data:image/png;base64,${imgPart.inlineData.data}`;
          responseText = "Here is your generated image.";
        }
      } else if (mode === 'video_gen') {
        // Video Generation
        let operation = await ai.models.generateVideos({
          model: 'veo-3.1-fast-generate-preview',
          prompt: userText,
          config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
        });
        
        responseText = "Generating video... this may take a few minutes.";
        
        // Save initial message
        const docRef = await addDoc(collection(db, 'users', user.uid, 'messages'), {
          uid: user.uid,
          role: 'ai',
          text: responseText,
          timestamp: Date.now()
        });

        // Poll in background
        const pollVideo = async () => {
          try {
            while (!operation.done) {
              await new Promise(resolve => setTimeout(resolve, 10000));
              operation = await ai.operations.getVideosOperation({operation: operation});
            }
            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
              // Fetch video to get base64 or just use the link if possible, but we need to pass API key.
              // For now, we'll just store the URI and fetch it on the client side with the API key.
              // Actually, the best way to display it is to fetch it and create an object URL or base64.
              const response = await fetch(downloadLink, {
                method: 'GET',
                headers: {
                  'x-goog-api-key': process.env.GEMINI_API_KEY as string,
                },
              });
              const blob = await response.blob();
              const reader = new FileReader();
              reader.readAsDataURL(blob);
              reader.onloadend = async () => {
                const base64data = reader.result as string;
                // Update the message with the video
                // We need to import doc and updateDoc from firebase/firestore
                // But we can just add a new message or update the existing one.
                // Let's just add a new message for simplicity, or update if we import updateDoc.
                await addDoc(collection(db, 'users', user.uid, 'messages'), {
                  uid: user.uid,
                  role: 'ai',
                  text: "Video generated successfully.",
                  media: base64data,
                  timestamp: Date.now()
                });
              };
            }
          } catch (err) {
            console.error("Video polling error:", err);
            await addDoc(collection(db, 'users', user.uid, 'messages'), {
              uid: user.uid,
              role: 'ai',
              text: "Video generation failed.",
              timestamp: Date.now()
            });
          }
        };
        
        pollVideo();
        
        // We already saved the initial message, so we can return early or set responseText to empty
        // to avoid saving it again at the end of the try block.
        setIsTyping(false);
        setFiles([]);
        setFilePreviews([]);
        return;
      } else if (mode === 'tts') {
        // Text to Speech
        const res = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: userText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
          }
        });
        const audioData = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioData) {
          responseMedia = `data:audio/mp3;base64,${audioData}`;
          responseText = "Audio generated.";
        }
      } else {
        // Standard Chat / Vision / Audio / Video Understanding
        let modelName = 'gemini-3.1-pro-preview';
        
        if (useThinking) {
          modelName = 'gemini-3.1-pro-preview';
        } else if (useSearch) {
          modelName = 'gemini-3-flash-preview';
        } else if (useFast) {
          modelName = 'gemini-3.1-flash-lite-preview';
        }
        
        const parts: any[] = [];
        if (userText) parts.push({ text: userText });
        
        for (const file of files) {
          const base64 = await fileToBase64(file);
          parts.push({
            inlineData: {
              data: base64,
              mimeType: file.type
            }
          });
          // If it's audio and no specific mode is selected, use flash
          if (file.type.startsWith('audio/') && !useThinking && !useSearch && !useFast) {
             modelName = 'gemini-3-flash-preview';
          }
        }

        const config: any = {};
        if (useThinking) config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        if (useSearch) config.tools = [{ googleSearch: {} }];
        if (useMaps) config.tools = [{ googleMaps: {} }];

        const res = await ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: Object.keys(config).length > 0 ? config : undefined
        });

        responseText = res.text || "No response.";
        
        // Extract grounding chunks if any
        const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
           responseText += "\\n\\nSources:\\n" + JSON.stringify(chunks, null, 2);
        }
      }

      // Save AI message
      await addDoc(collection(db, 'users', user.uid, 'messages'), {
        uid: user.uid,
        role: 'ai',
        text: responseText,
        media: responseMedia,
        timestamp: Date.now()
      });

    } catch (error: any) {
      console.error(error);
      await addDoc(collection(db, 'users', user.uid, 'messages'), {
        uid: user.uid,
        role: 'ai',
        text: `Error: ${error.message}`,
        timestamp: Date.now()
      });
    } finally {
      setIsTyping(false);
      setFiles([]);
      setFilePreviews([]);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="bg-slate-900 p-8 rounded-2xl shadow-2xl border border-slate-800 text-center max-w-md w-full">
          <Brain className="w-16 h-16 text-blue-500 mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-2">Lumina Nexus</h1>
          <p className="text-slate-400 mb-8">The ultimate multimodal AI companion powered by Gemini 3.1 Pro, Flash, and Veo.</p>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
          >
            <img src="https://www.gstatic.com/mobilesdk/250721_mobilesdk/mono_firebase_dark.svg" className="w-5 h-5" alt="Firebase" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-blue-500" />
            <span className="font-bold text-lg">Lumina Nexus</span>
          </div>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto space-y-6">
          <div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Modes</h3>
            <div className="space-y-2">
              <button onClick={() => setMode('chat')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${mode === 'chat' ? 'bg-blue-600/20 text-blue-400' : 'hover:bg-slate-800'}`}>
                <MessageSquare className="w-4 h-4" /> Chat & Vision
              </button>
              <button onClick={() => setMode('image_gen')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${mode === 'image_gen' ? 'bg-purple-600/20 text-purple-400' : 'hover:bg-slate-800'}`}>
                <ImageIcon className="w-4 h-4" /> Generate Image
              </button>
              <button onClick={() => setMode('video_gen')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${mode === 'video_gen' ? 'bg-pink-600/20 text-pink-400' : 'hover:bg-slate-800'}`}>
                <Video className="w-4 h-4" /> Generate Video
              </button>
              <button onClick={() => setMode('tts')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${mode === 'tts' ? 'bg-green-600/20 text-green-400' : 'hover:bg-slate-800'}`}>
                <Volume2 className="w-4 h-4" /> Text to Speech
              </button>
              <button onClick={() => setMode('live')} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${mode === 'live' ? 'bg-red-600/20 text-red-400' : 'hover:bg-slate-800'}`}>
                <Mic className="w-4 h-4" /> Live Audio
              </button>
            </div>
          </div>

          {mode === 'chat' && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Capabilities</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={useFast} onChange={e => setUseFast(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500" />
                  <Zap className="w-4 h-4 text-yellow-500" /> Fast Mode (Flash-Lite)
                </label>
                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={useThinking} onChange={e => setUseThinking(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500" />
                  <Brain className="w-4 h-4 text-purple-500" /> Deep Thinking
                </label>
                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={useSearch} onChange={e => setUseSearch(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500" />
                  <Search className="w-4 h-4 text-blue-400" /> Google Search
                </label>
                <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={useMaps} onChange={e => setUseMaps(e.target.checked)} className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500" />
                  <MapPin className="w-4 h-4 text-red-400" /> Google Maps
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 truncate text-sm">{user.email}</div>
            <button onClick={logOut} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {mode === 'live' ? (
          <LiveAudioSession />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                  <Sparkles className="w-12 h-12 opacity-20" />
                  <p>How can I help you today?</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl p-4 ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 rounded-tl-none'}`}>
                      {msg.hasFiles && msg.role === 'user' && (
                        <div className="flex gap-2 mb-2">
                          <Paperclip className="w-4 h-4 opacity-50" />
                          <span className="text-xs opacity-50">Attachments included</span>
                        </div>
                      )}
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      {msg.media && (
                        <div className="mt-4 rounded-lg overflow-hidden border border-white/10">
                          {msg.media.startsWith('data:image') ? (
                            <img src={msg.media} alt="Generated" className="max-w-full h-auto" />
                          ) : msg.media.startsWith('data:audio') ? (
                            <audio controls src={msg.media} className="w-full" />
                          ) : msg.media.startsWith('data:video') ? (
                            <video controls src={msg.media} className="w-full max-w-full h-auto" />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-800 rounded-2xl rounded-tl-none p-4 flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                    <span className="text-slate-400 text-sm">Processing...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-slate-900 border-t border-slate-800">
              {filePreviews.length > 0 && (
                <div className="flex gap-3 mb-3 overflow-x-auto pb-2">
                  {filePreviews.map((preview, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-lg bg-slate-800 border border-slate-700 flex-shrink-0 group">
                      {files[i].type.startsWith('image/') ? (
                        <img src={preview} className="w-full h-full object-cover rounded-lg" alt="preview" />
                      ) : files[i].type.startsWith('video/') ? (
                        <div className="w-full h-full flex items-center justify-center"><FileVideo className="w-6 h-6 text-slate-400" /></div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><FileAudio className="w-6 h-6 text-slate-400" /></div>
                      )}
                      <button onClick={() => removeFile(i)} className="absolute -top-2 -right-2 bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <form onSubmit={handleSend} className="relative flex items-end gap-2">
                {mode === 'chat' && (
                  <>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple accept="image/*,video/*,audio/*" />
                  </>
                )}
                
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
                  placeholder={
                    mode === 'image_gen' ? "Describe the image to generate..." :
                    mode === 'video_gen' ? "Describe the video to generate..." :
                    mode === 'tts' ? "Enter text to convert to speech..." :
                    "Message Lumina... (Shift+Enter for new line)"
                  }
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 min-h-[50px] max-h-32 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  rows={1}
                />
                
                <button 
                  type="submit" 
                  disabled={isTyping || (!input.trim() && files.length === 0)}
                  className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default App;
