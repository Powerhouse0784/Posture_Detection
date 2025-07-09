import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Pose } from '@mediapipe/pose';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { Chart, registerables } from 'chart.js';
import './App.css';

// Register Chart.js components
Chart.register(...registerables);

const PostureDetector = () => {
  // Refs
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const historyChartRef = useRef(null);
  const poseRef = useRef(null);
  const cameraRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastAudioTimeRef = useRef(0);

  // State
  const [mode, setMode] = useState('desk');
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [postureStatus, setPostureStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('webcam');
  const [darkMode, setDarkMode] = useState(false);
  const [postureHistory, setPostureHistory] = useState([]);
  const [detectedPersons, setDetectedPersons] = useState(0);

  // Initialize dark mode
  useEffect(() => {
    document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Posture analysis function
  const analyzePosture = useCallback((landmarks, currentMode) => {
    if (!landmarks) return { badPosture: false, messages: [], score: 100 };

    const LEFT_SHOULDER = 11;
    const LEFT_HIP = 23;
    const LEFT_KNEE = 25;
    const LEFT_ANKLE = 27;
    const LEFT_FOOT_INDEX = 31;
    const LEFT_EAR = 7;

    const result = {
      badPosture: false,
      messages: [],
      score: 100 // Start with perfect score
    };

    if (currentMode === 'squat') {
      const kneeToAnkleRatio = (landmarks[LEFT_KNEE].x - landmarks[LEFT_ANKLE].x) / 
                            (landmarks[LEFT_FOOT_INDEX].x - landmarks[LEFT_ANKLE].x);
      if (kneeToAnkleRatio > 1.0) {
        result.badPosture = true;
        result.messages.push("Knees are going over toes");
        result.score -= 20;
      }

      const backAngle = calculateAngle(
        landmarks[LEFT_SHOULDER],
        landmarks[LEFT_HIP],
        landmarks[LEFT_KNEE]
      );
      if (backAngle > 40) {
        result.badPosture = true;
        result.messages.push(`Back angle too small (${Math.round(backAngle)}°)`);
        result.score -= 15;
      }
    } else if (currentMode === 'desk') {
      const neckAngle = calculateAngle(
        landmarks[LEFT_EAR],
        landmarks[LEFT_SHOULDER],
        { x: landmarks[LEFT_SHOULDER].x, y: 0 }
      );
      if (neckAngle > 40) {
        result.badPosture = true;
        result.messages.push(`Neck bending too far (${Math.round(neckAngle)}°)`);
        result.score -= 25;
      }

      const backAngle = calculateAngle(
        landmarks[LEFT_SHOULDER],
        landmarks[LEFT_HIP],
        { x: landmarks[LEFT_HIP].x, y: 0 }
      );
      if (backAngle > 10) {
        result.badPosture = true;
        result.messages.push(`Back not straight (${Math.round(backAngle)}°)`);
        result.score -= 20;
      }
    }

    // Ensure score doesn't go below 0
    result.score = Math.max(0, result.score);
    return result;
  }, []);

  const calculateAngle = (a, b, c) => {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const cb = { x: b.x - c.x, y: b.y - c.y };
    const dot = (ab.x * cb.x + ab.y * cb.y);
    const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
    const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
    const angleRad = Math.acos(dot / (magAB * magCB));
    return angleRad * (180 / Math.PI);
  };

  // Audio feedback with rate limiting
  const giveAudioFeedback = (messages) => {
    const now = Date.now();
    if (now - lastAudioTimeRef.current > 5000) { // Only speak every 5 seconds
      lastAudioTimeRef.current = now;
      const utterance = new SpeechSynthesisUtterance(messages[0]);
      utterance.rate = 0.9;
      speechSynthesis.speak(utterance);
    }
  };

  const onResults = useCallback((results) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const video = isWebcamActive ? webcamRef.current?.video : videoRef.current;
    
    if (!ctx || !video) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.poseLandmarks) {
      // Count detected persons (simplified - MediaPipe usually detects one person)
      const personCount = results.poseLandmarks ? 1 : 0;
      setDetectedPersons(personCount);

      drawConnectors(ctx, results.poseLandmarks, Pose.POSE_CONNECTIONS, 
        { color: darkMode ? '#00FF00' : '#006400', lineWidth: 4 });
      drawLandmarks(ctx, results.poseLandmarks, 
        { color: darkMode ? '#FF0000' : '#8B0000', lineWidth: 1, radius: 2 });

      const analysis = analyzePosture(results.poseLandmarks, mode);
      setFeedback(analysis.messages);
      setPostureStatus(analysis.badPosture ? 'bad' : 'good');

      // Add to posture history
      const timestamp = new Date().toISOString();
      setPostureHistory(prev => [
        ...prev.slice(-29), // Keep last 29 entries
        { timestamp, score: analysis.score, mode }
      ]);

      // Audio feedback
      if (analysis.badPosture) {
        giveAudioFeedback(analysis.messages);
      }

      // Draw posture status border
      ctx.strokeStyle = analysis.badPosture ? 
        (darkMode ? '#FF0000' : '#8B0000') : 
        (darkMode ? '#00FF00' : '#006400');
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.rect(5, 5, canvas.width - 10, canvas.height - 10);
      ctx.stroke();
    }

    ctx.restore();
  }, [mode, analyzePosture, isWebcamActive, darkMode]);

  // Initialize MediaPipe
  useEffect(() => {
    const initializePose = async () => {
      setLoading(true);
      const pose = new Pose({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`;
        }
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      pose.onResults(onResults);
      poseRef.current = pose;
      setLoading(false);
    };

    initializePose();

    return () => {
      poseRef.current?.close();
      cancelAnimationFrame(animationFrameRef.current);
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
      if (historyChartRef.current) {
        historyChartRef.current.destroy();
      }
    };
  }, [onResults]);

  // Initialize history chart
  useEffect(() => {
    if (postureHistory.length > 0 && canvasRef.current) {
      const ctx = document.getElementById('historyChart').getContext('2d');
      
      if (historyChartRef.current) {
        historyChartRef.current.destroy();
      }

      historyChartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: postureHistory.map((_, i) => i + 1),
          datasets: [{
            label: 'Posture Score',
            data: postureHistory.map(entry => entry.score),
            borderColor: darkMode ? '#818cf8' : '#4f46e5',
            backgroundColor: darkMode ? 'rgba(129, 140, 248, 0.1)' : 'rgba(79, 70, 229, 0.1)',
            tension: 0.3,
            fill: true
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: {
              min: 0,
              max: 100,
              ticks: {
                color: darkMode ? '#e5e7eb' : '#4b5563'
              },
              grid: {
                color: darkMode ? 'rgba(229, 231, 235, 0.1)' : 'rgba(75, 85, 99, 0.1)'
              }
            },
            x: {
              ticks: {
                color: darkMode ? '#e5e7eb' : '#4b5563'
              },
              grid: {
                color: darkMode ? 'rgba(229, 231, 235, 0.1)' : 'rgba(75, 85, 99, 0.1)'
              }
            }
          },
          plugins: {
            legend: {
              labels: {
                color: darkMode ? '#e5e7eb' : '#4b5563'
              }
            }
          }
        }
      });
    }
  }, [postureHistory, darkMode]);

  // Handle video processing
  useEffect(() => {
    if (!videoUrl || !videoRef.current || !poseRef.current) return;

    const video = videoRef.current;
    let animationFrameId;

    const processFrame = async () => {
      if (video.paused || video.ended) {
        setIsAnalyzing(false);
        return;
      }

      try {
        await poseRef.current.send({ image: video });
        animationFrameId = requestAnimationFrame(processFrame);
        animationFrameRef.current = animationFrameId;
      } catch (error) {
        console.error('Error processing frame:', error);
        setIsAnalyzing(false);
      }
    };

    const handlePlay = () => {
      setIsAnalyzing(true);
      processFrame();
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', () => cancelAnimationFrame(animationFrameId));
    video.addEventListener('ended', () => cancelAnimationFrame(animationFrameId));

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', () => cancelAnimationFrame(animationFrameId));
      video.removeEventListener('ended', () => cancelAnimationFrame(animationFrameId));
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoUrl]);

  // Handle webcam
  useEffect(() => {
    if (isWebcamActive && webcamRef.current && poseRef.current) {
      cameraRef.current = new Camera(webcamRef.current.video, {
        onFrame: async () => {
          if (webcamRef.current?.video) {
            await poseRef.current.send({ image: webcamRef.current.video });
          }
        },
        width: 640,
        height: 480
      });
      cameraRef.current.start();
    } else if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }

    return () => {
      if (cameraRef.current) {
        cameraRef.current.stop();
      }
    };
  }, [isWebcamActive]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setIsWebcamActive(false);
      setFeedback(null);
      setPostureStatus(null);
      setActiveTab('video');
    }
    e.target.value = ''; // Reset input to allow same file to be selected again
  };

  const handleModeChange = (e) => {
    setMode(e.target.value);
    setFeedback(null);
    setPostureStatus(null);
  };

  const toggleWebcam = async () => {
    try {
      if (!isWebcamActive) {
        await navigator.mediaDevices.getUserMedia({ video: true });
        setIsWebcamActive(true);
        setVideoUrl('');
        setFeedback(null);
        setPostureStatus(null);
        setActiveTab('webcam');
      } else {
        setIsWebcamActive(false);
      }
    } catch (err) {
      console.error("Error accessing webcam:", err);
      setFeedback(['Could not access webcam. Please check permissions.']);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  return (
    <div className="container">
      <div className="app-header">
        <h1 className="app-title">Posture Perfect</h1>
        <p className="app-subtitle">Real-time posture analysis and feedback</p>
        <button 
          className="dark-mode-toggle"
          onClick={toggleDarkMode}
          aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>
      
      <div className="controls-panel glassmorphism">
        <div className="mode-selector">
          <h3 className="section-title">Select Mode:</h3>
          <div className="mode-options">
            <label className={`mode-option ${mode === 'desk' ? 'active' : ''}`}>
              <input 
                type="radio" 
                value="desk" 
                checked={mode === 'desk'} 
                onChange={handleModeChange} 
              />
              <span className="mode-icon">💺</span>
              Desk Sitting
            </label>
            <label className={`mode-option ${mode === 'squat' ? 'active' : ''}`}>
              <input 
                type="radio" 
                value="squat" 
                checked={mode === 'squat'} 
                onChange={handleModeChange} 
              />
              <span className="mode-icon">🏋️</span>
              Squat
            </label>
          </div>
        </div>
        
        <div className="source-tabs">
          <button 
            className={`tab-btn ${activeTab === 'webcam' ? 'active' : ''}`}
            onClick={() => {
              toggleWebcam();
              setActiveTab('webcam');
            }}
            disabled={loading}
          >
            <span className="tab-icon">📷</span>
            {isWebcamActive ? 'Stop Webcam' : 'Start Webcam'}
          </button>
          <button 
            className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`}
            onClick={triggerFileInput}
            disabled={loading}
          >
            <span className="tab-icon">🎥</span>
            Upload Video
            <input 
              ref={fileInputRef}
              type="file" 
              accept="video/*" 
              onChange={handleFileChange} 
              style={{ display: 'none' }}
            />
          </button>
        </div>
      </div>
      
      <div className="analysis-container">
        <div className={`video-analysis-container glassmorphism ${postureStatus || ''}`}>
          {loading ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <p>Initializing posture detection...</p>
            </div>
          ) : isWebcamActive ? (
            <div className="webcam-wrapper">
              <Webcam
                ref={webcamRef}
                className="video-element"
                videoConstraints={{ facingMode: 'user' }}
                forceScreenshotSourceSize
              />
              <canvas
                ref={canvasRef}
                className="canvas-overlay"
              />
              <div className="person-counter">
                👥 Detected: {detectedPersons}
              </div>
            </div>
          ) : videoUrl ? (
            <div className="video-wrapper">
              <video 
                ref={videoRef}
                src={videoUrl}
                controls
                className="video-element"
                playsInline
                onLoadedMetadata={() => {
                  if (canvasRef.current && videoRef.current) {
                    canvasRef.current.width = videoRef.current.videoWidth;
                    canvasRef.current.height = videoRef.current.videoHeight;
                  }
                }}
              />
              <canvas
                ref={canvasRef}
                className="canvas-overlay"
              />
              <div className="person-counter">
                👥 Detected: {detectedPersons}
              </div>
            </div>
          ) : (
            <div className="placeholder glassmorphism">
              <div className="placeholder-content">
                <div className="placeholder-icon">👋</div>
                <h3>Welcome to Posture Perfect</h3>
                <p>Select a mode and start analyzing your posture</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="history-container glassmorphism">
          <h3 className="section-title">Posture History</h3>
          <div className="chart-container">
            <canvas id="historyChart"></canvas>
          </div>
        </div>
      </div>
      
      <div className={`feedback-panel glassmorphism ${feedback !== null ? 'visible' : ''} ${postureStatus || ''}`}>
        <h2 className="feedback-title">
          {postureStatus === 'bad' ? '⚠️ Posture Issues' : postureStatus === 'good' ? '✓ Good Posture' : 'Posture Feedback'}
        </h2>
        {feedback === null ? (
          <p className="initial-message">Your posture analysis will appear here</p>
        ) : feedback.length > 0 ? (
          <ul className="error-list">
            {feedback.map((msg, index) => (
              <li key={index}>
                <span className="error-icon">❌</span> {msg}
              </li>
            ))}
          </ul>
        ) : (
          <div className="success-message">
            <span className="success-icon">✅</span>
            <p>Excellent posture! Keep it up!</p>
          </div>
        )}
      </div>
      
      <div className="app-footer">
        <p>PosturePerfect © {new Date().getFullYear()} - Your Posture Companion</p>
      </div>
    </div>
  );
};

export default PostureDetector;