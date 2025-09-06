import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Camera, Eye, Brain, Zap } from 'lucide-react';

const FaceDetectionApp = () => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);

    // Initialization and state management
    const [isScriptLoaded, setIsScriptLoaded] = useState(false);
    const [isModelsLoading, setIsModelsLoading] = useState(false);
    const [modelsLoaded, setModelsLoaded] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [stream, setStream] = useState(null);
    const [status, setStatus] = useState({ message: '🤖 Initializing...', type: 'info' });
    const [displaySize, setDisplaySize] = useState({ width: 640, height: 480 });
    const detectionIntervalRef = useRef(null);
    const ageGenderNetAvailableRef = useRef(false);

    // Model loading status
    const [modelStatus, setModelStatus] = useState({
        faceDetection: false,
        expressions: false,
        age: false,
        landmarks: false,
    });

    // --- MODIFIED --- Helper function to determine age range
    const getAgeRange = (age) => {
        if (age <= 12) return 'Child';
        if (age <= 19) return 'Teen';
        if (age <= 39) return 'Young Adult';
        if (age <= 59) return 'Middle-Aged Adult';
        if (age > 59) return 'Senior';
        return '--';
    };

    // Detection results with proper initialization
    const exprKeys = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised'];
    const EXPRESSION_EMOJIS = {
        'neutral': '😐', 'happy': '😊', 'sad': '😢', 'angry': '😠',
        'fearful': '😨', 'disgusted': '🤢', 'surprised': '😲'
    };
    const initialExpressions = Object.fromEntries(exprKeys.map(key => [key, 0]));
    const [results, setResults] = useState({
        age: '--',
        gender: '--',
        ageRange: '--',
        ageEstimate: '--', // <-- NEW: Added a precise age estimate field
        dominantExpression: { name: '--', confidence: 0, emoji: '😐' },
        expressions: initialExpressions,
        stats: {
            detectionRate: '0 FPS',
            faceCount: 0,
            processingTime: '--',
            analysisCount: 0
        }
    });

    // Refs for performance tracking
    const detectionCountRef = useRef(0);
    const lastDetectionTimeRef = useRef(Date.now());
    const processingTimesRef = useRef([]);
    const analysisCounterRef = useRef(0);
    const ageHistoryRef = useRef([]);

    // --- Core Logic ---

    const updateStatus = (message, type = 'info') => {
        setStatus({ message, type });
        console.log(`[${type.toUpperCase()}] ${message}`);
    };
    
    // Step 1: Load the face-api.js script
    useEffect(() => {
        const loadScript = () => {
            if (window.faceapi) {
                setIsScriptLoaded(true);
                return;
            }
            updateStatus('Loading AI library...', 'info');
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js';
            script.async = true;
            script.onload = () => setIsScriptLoaded(true);
            script.onerror = () => updateStatus('❌ Failed to load AI library.', 'error');
            document.head.appendChild(script);
        };
        loadScript();
        
        // Cleanup on unmount
        return () => {
            if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
            if (stream) stream.getTracks().forEach(track => track.stop());
        };
    }, []);

    // Step 2: Load AI models once the script is ready
    useEffect(() => {
        const loadModels = async () => {
            if (!isScriptLoaded || modelsLoaded || isModelsLoading) return;

            setIsModelsLoading(true);
            updateStatus('🤖 Loading AI models...', 'info');
            const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';

            try {
                await Promise.all([
                    window.faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL).then(() => setModelStatus(prev => ({ ...prev, faceDetection: true }))),
                    window.faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL).then(() => setModelStatus(prev => ({ ...prev, landmarks: true }))),
                    window.faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL).then(() => setModelStatus(prev => ({ ...prev, expressions: true }))),
                ]);
                
                try {
                    await window.faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
                    ageGenderNetAvailableRef.current = true;
                    setModelStatus(prev => ({ ...prev, age: true }));
                } catch (error) {
                    console.warn('⚠️ Age/Gender model failed to load:', error.message);
                    updateStatus('Age/Gender model unavailable, continuing without it.', 'warning');
                }

                setModelsLoaded(true);
                updateStatus('✅ Models loaded! Ready for detection.', 'success');
            } catch (error) {
                console.error('❌ Model loading error:', error);
                updateStatus(`❌ Failed to load models: ${error.message}`, 'error');
            } finally {
                setIsModelsLoading(false);
            }
        };

        loadModels();
    }, [isScriptLoaded, modelsLoaded, isModelsLoading]);

    // Step 3: Start the camera
    const startCamera = async () => {
        if (stream || !modelsLoaded) return;

        try {
            updateStatus('🎥 Accessing camera...', 'info');
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
            });
            setStream(newStream);

            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.onloadedmetadata = () => {
                    const newDisplaySize = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
                    setDisplaySize(newDisplaySize);
                    if (canvasRef.current) {
                        canvasRef.current.width = newDisplaySize.width;
                        canvasRef.current.height = newDisplaySize.height;
                    }
                    videoRef.current.play();
                    setIsDetecting(true);
                    startDetection();
                    updateStatus('🚀 Detection active!', 'success');
                };
            }
        } catch (error) {
            console.error('❌ Camera error:', error);
            updateStatus(`❌ Camera error: ${error.name === 'NotAllowedError' ? 'Permission denied' : error.message}`, 'error');
        }
    };
    
    // Step 4: Stop the camera and cleanup
    const stopCamera = () => {
        if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
        if (stream) stream.getTracks().forEach(track => track.stop());
        
        if (videoRef.current) videoRef.current.srcObject = null;
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        setStream(null);
        setIsDetecting(false);
        resetDisplays();
        updateStatus('📷 Camera stopped.', 'info');
    };
    
    // Step 5: The detection loop
    const startDetection = () => {
        const options = new window.faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });

        detectionIntervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.paused || videoRef.current.ended || videoRef.current.readyState < 4) {
                return;
            }

            const startTime = performance.now();
            let detectionPipeline = window.faceapi.detectSingleFace(videoRef.current, options)
                .withFaceLandmarks()
                .withFaceExpressions();
            
            if (ageGenderNetAvailableRef.current) {
                detectionPipeline = detectionPipeline.withAgeAndGender();
            }

            const detection = await detectionPipeline;
            const processingTime = performance.now() - startTime;
            
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (detection) {
                const resizedDetection = window.faceapi.resizeResults(detection, displaySize);
                window.faceapi.draw.drawDetections(canvasRef.current, resizedDetection);
                window.faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetection);
                processDetectionResults(detection);
            }
            
            updateStats(processingTime, detection ? 1 : 0);
        }, 200); // Interval for stability
    };
    
    // --- Helper Functions ---

    const processDetectionResults = (detection) => {
        // Process Expressions
        const expressions = detection.expressions;
        const dominantExpression = Object.entries(expressions).sort((a, b) => b[1] - a[1])[0];
        
        // --- MODIFIED --- Process Age, Gender, and Age Range
        let smoothedAge = results.age;
        let ageRange = results.ageRange;
        let ageEstimate = '--';

        if (ageGenderNetAvailableRef.current && detection.age) {
            ageHistoryRef.current.push(detection.age);
            if (ageHistoryRef.current.length > 5) ageHistoryRef.current.shift();

            // Calculate median of the last 5 detections for a more stable age
            const sortedAges = [...ageHistoryRef.current].sort((a, b) => a - b);
            const mid = Math.floor(sortedAges.length / 2);
            smoothedAge = sortedAges.length % 2 !== 0 ? sortedAges[mid] : Math.round((sortedAges[mid - 1] + sortedAges[mid]) / 2);
            
            // Round the smoothed age to a whole number
            const roundedAge = Math.round(smoothedAge);

            // Calculate the dynamic age range
            const minAge = Math.max(0, roundedAge - 2);
            const maxAge = roundedAge + 2;
            ageEstimate = `${minAge} to ${maxAge}`;
            ageRange = getAgeRange(roundedAge);
        }

        setResults(prev => ({
            ...prev,
            age: ageGenderNetAvailableRef.current ? Math.round(smoothedAge) : '--',
            gender: ageGenderNetAvailableRef.current ? `${detection.gender} (${Math.round(detection.genderProbability * 100)}%)` : '--',
            ageRange: ageGenderNetAvailableRef.current ? ageRange : '--',
            ageEstimate: ageGenderNetAvailableRef.current ? ageEstimate : '--',
            expressions: expressions,
            dominantExpression: {
                name: dominantExpression[0],
                confidence: Math.round(dominantExpression[1] * 100),
                emoji: EXPRESSION_EMOJIS[dominantExpression[0]] || '😐'
            }
        }));
    };

    const updateStats = (processingTimeMs, faceCount) => {
        detectionCountRef.current++;
        processingTimesRef.current.push(processingTimeMs);
        if (processingTimesRef.current.length > 10) processingTimesRef.current.shift();

        const now = Date.now();
        if (now - lastDetectionTimeRef.current >= 1000) {
            const fps = detectionCountRef.current;
            const avgTime = Math.round(processingTimesRef.current.reduce((a, b) => a + b, 0) / processingTimesRef.current.length);
            
            analysisCounterRef.current++;
            
            setResults(prev => ({
                ...prev,
                stats: {
                    detectionRate: `${fps} FPS`,
                    faceCount: faceCount,
                    processingTime: `${avgTime}ms`,
                    analysisCount: analysisCounterRef.current
                }
            }));
            
            detectionCountRef.current = 0;
            lastDetectionTimeRef.current = now;
        }
    };

    const resetDisplays = () => {
        setResults({
            age: '--', gender: '--', ageRange: '--', ageEstimate: '--',
            dominantExpression: { name: '--', confidence: 0, emoji: '😐' },
            expressions: initialExpressions,
            stats: { detectionRate: '0 FPS', faceCount: 0, processingTime: '--', analysisCount: 0 }
        });
        ageHistoryRef.current = [];
        processingTimesRef.current = [];
    };

    const captureSnapshot = () => {
        if (!stream || !canvasRef.current || !videoRef.current) return;

        try {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = displaySize.width;
            tempCanvas.height = displaySize.height;
            const tempCtx = tempCanvas.getContext('2d');
            
            tempCtx.translate(displaySize.width, 0);
            tempCtx.scale(-1, 1);
            tempCtx.drawImage(videoRef.current, 0, 0, displaySize.width, displaySize.height);
            tempCtx.setTransform(1, 0, 0, 0, 0, 0);
            tempCtx.drawImage(canvasRef.current, 0, 0);
            
            const url = tempCanvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = `face-analysis-${Date.now()}.png`;
            a.click();
            
            updateStatus('📸 Snapshot captured!', 'success');
        } catch (error) {
            console.error('Snapshot error:', error);
            updateStatus('❌ Snapshot failed', 'error');
        }
    };
    
    // --- UI Components ---

    const StatusBadge = ({ type, message }) => {
        const colors = {
            info: 'border-blue-500 bg-blue-500/10 text-blue-300',
            success: 'border-green-500 bg-green-500/10 text-green-300', 
            error: 'border-red-500 bg-red-500/10 text-red-300',
            warning: 'border-yellow-500 bg-yellow-500/10 text-yellow-300'
        };
        const Icon = { info: Brain, success: Eye, error: Zap, warning: Zap }[type];
        
        return (
            <div className={`p-3 rounded-lg border-l-4 ${colors[type]} backdrop-blur-sm mb-4 flex items-center`}>
                <Icon className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="text-sm">{message}</span>
            </div>
        );
    };

    const ModelChip = ({ label, active }) => (
        <div className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-300 ${active ? 'bg-green-500 text-white border-green-400' : 'bg-gray-700 text-gray-300 border-gray-600'}`}>
            {label}
        </div>
    );
    
    const getButtonText = () => {
        if (!isScriptLoaded) return 'Loading Library...';
        if (isModelsLoading) return 'Loading Models...';
        if (!modelsLoaded) return 'Models Not Loaded';
        return 'Start Detection';
    };

    return (
        <div className="flex h-screen bg-gray-900 text-white overflow-hidden">
            {/* Video Section */}
            <div className="flex-1 relative flex items-center justify-center bg-black">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                <canvas ref={canvasRef} className="absolute inset-0 transform scale-x-[-1] pointer-events-none" />
                {!isDetecting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <div className="text-center">
                            <div className="text-6xl mb-4">🤖</div>
                            <div className="text-xl font-bold mb-2">AI Face Detection</div>
                            <div className="text-gray-400">Start the camera to begin analysis</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Sidebar */}
            <aside className="w-96 bg-gray-800 p-6 overflow-y-auto">
                <div className="mb-6">
                    <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent mb-2">
                        🎯 Real-Time Face Analysis
                    </h1>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                    <ModelChip label="Face Detection" active={modelStatus.faceDetection} />
                    <ModelChip label="Expressions" active={modelStatus.expressions} />
                    <ModelChip label="Age/Gender" active={modelStatus.age} />
                    <ModelChip label="Landmarks" active={modelStatus.landmarks} />
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                    <button onClick={startCamera} disabled={!modelsLoaded || isDetecting} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors">
                        <Play className="w-4 h-4" />
                        {getButtonText()}
                    </button>
                    <button onClick={stopCamera} disabled={!isDetecting} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors">
                        <Square className="w-4 h-4" />
                        Stop
                    </button>
                    <button onClick={captureSnapshot} disabled={!isDetecting} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors">
                        <Camera className="w-4 h-4" />
                        Capture
                    </button>
                </div>

                <StatusBadge type={status.type} message={status.message} />

                {isDetecting && (
                    <div className="space-y-4 animate-fade-in">
                        
                        {/* --- MODIFIED --- Dedicated Age & Gender Card */}
                        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-lg p-4">
                            <h3 className="text-lg font-bold text-amber-400 mb-2">Age & Gender Analysis</h3>
                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div>
                                    <div className="text-3xl font-bold text-white">{results.age}</div>
                                    <div className="text-sm text-gray-400">Smoothed Age</div>
                                </div>
                                <div>
                                    <div className="text-3xl font-bold text-white">{results.ageRange}</div>
                                    <div className="text-sm text-gray-400">Age Range</div>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-amber-600/50 text-center">
                                <div className="text-sm font-semibold text-white">Estimated Age: {results.ageEstimate}</div>
                            </div>
                            {results.gender !== '--' && (
                                <div className="mt-4 pt-4 border-t border-amber-600/50 text-center">
                                    <div className="text-white font-semibold">{results.gender}</div>
                                    <div className="text-sm text-gray-400">Predicted Gender</div>
                                </div>
                            )}
                        </div>

                        {/* --- MODIFIED --- Expression Analysis Card */}
                        <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-lg p-4">
                            <h3 className="text-lg font-bold text-cyan-400 mb-2">Expression Analysis</h3>
                            <div className="flex items-center gap-4">
                                <div className="text-4xl">{results.dominantExpression.emoji}</div>
                                <div>
                                    <div className="text-xl font-bold text-white capitalize">{results.dominantExpression.name}</div>
                                    <div className="text-sm text-gray-400">{results.dominantExpression.confidence}% Confidence</div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-md font-bold text-white">Expression Details</h3>
                            {exprKeys.map(expr => (
                                <div key={expr} className="flex items-center justify-between p-2 bg-gray-700 rounded-md">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span>{EXPRESSION_EMOJIS[expr]}</span>
                                        <span className="capitalize font-medium">{expr}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-20 bg-gray-600 rounded-full h-2 overflow-hidden">
                                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${Math.round(results.expressions[expr] * 100)}%` }} />
                                        </div>
                                        <span className="text-sm font-bold w-8 text-right">{Math.round(results.expressions[expr] * 100)}%</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="bg-gray-700 p-3 rounded-md">
                                <div className="text-gray-400">Detection Rate</div>
                                <div className="font-bold">{results.stats.detectionRate}</div>
                            </div>
                            <div className="bg-gray-700 p-3 rounded-md">
                                <div className="text-gray-400">Processing Time</div>
                                <div className="font-bold">{results.stats.processingTime}</div>
                            </div>
                            <div className="bg-gray-700 p-3 rounded-md">
                                <div className="text-gray-400">Faces Detected</div>
                                <div className="font-bold">{results.stats.faceCount}</div>
                            </div>
                            <div className="bg-gray-700 p-3 rounded-md">
                                <div className="text-gray-400">Analyses</div>
                                <div className="font-bold">{results.stats.analysisCount}</div>
                            </div>
                        </div>
                    </div>
                )}
            </aside>
        </div>
    );
};

export default FaceDetectionApp;