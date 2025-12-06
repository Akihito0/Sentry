import React, { useState, useMemo } from 'react';
import '../css/SafetyReports.css';

/**
 * Safety Reports Table Component
 * Shows flagged content events in a table format
 * - Parents see ALL family events (uncensored)
 * - Children see ONLY their events (censored)
 */
const SafetyReports = ({ 
  reports = [], 
  isParent = false, 
  currentUserId = null,
  onShowDetails = null 
}) => {
  const [selectedReport, setSelectedReport] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('all'); // 'all', 'today', 'week', 'month'
  const [showAIRecommendations, setShowAIRecommendations] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState(null);

  // Filter reports based on user role, search, and date
  const filteredReports = useMemo(() => {
    let filtered = reports;

    // Role-based filtering
    if (!isParent) {
      filtered = filtered.filter(report => report.user_id === currentUserId);
    }

    // Search filtering (only for parents searching by name)
    if (isParent && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(report => {
        const userName = (report.user_name || report.user_id || '').toLowerCase();
        return userName.includes(query);
      });
    }

    // Date filtering
    if (dateFilter !== 'all') {
      const now = new Date();
      filtered = filtered.filter(report => {
        const reportDate = new Date(report.detected_at);
        const diffTime = now - reportDate;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);

        if (dateFilter === 'today') return diffDays < 1;
        if (dateFilter === 'week') return diffDays < 7;
        if (dateFilter === 'month') return diffDays < 30;
        return true;
      });
    }

    return filtered;
  }, [reports, isParent, currentUserId, searchQuery, dateFilter]);

  // Sort by date (most recent first)
  const sortedReports = useMemo(() => {
    return [...filteredReports].sort((a, b) => {
      const dateA = new Date(a.detected_at || 0);
      const dateB = new Date(b.detected_at || 0);
      return dateB - dateA;
    });
  }, [filteredReports]);

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getCategoryIcon = (category) => {
    const icons = {
      explicit_content: '🔞',
      explicit_image: '🖼️',
      scam: '⚠️',
      fraud: '🚨',
      violence: '⚔️',
      hate_speech: '🚫',
      predatory: '⛔',
      harassment: '😡',
      profanity: '🤬',
      self_harm: '💔',
      alcohol_drugs: '🍺'
    };
    return icons[category] || '⚠️';
  };

  const getCategoryLabel = (category) => {
    return (category || 'unsafe_content')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleShowDetails = (report) => {
    setSelectedReport(report);
    setShowDetailsModal(true);
    if (onShowDetails) {
      onShowDetails(report);
    }
  };

  const closeModal = () => {
    setShowDetailsModal(false);
    setSelectedReport(null);
  };

  const handleGetAIRecommendations = async (report) => {
    setSelectedReport(report);
    setShowAIRecommendations(true);
    setLoadingAI(true);
    setAiError(null);
    setAiRecommendations('');

    try {
      // Prepare context for Gemini
      const userType = isParent ? 'parent' : 'child';
      const category = report.category || 'unsafe_content';
      const severity = report.severity || 'medium';
      const contentExcerpt = report.content_excerpt || report.summary || 'Flagged content detected';
      
      // Build comprehensive prompt for Gemini
      const prompt = `You are a child safety expert providing guidance on online safety incidents.

Context:
- User Type: ${userType}
- Incident Category: ${category.replace(/_/g, ' ')}
- Severity Level: ${severity}
- Content Description: ${contentExcerpt}
- Platform: ${report.page_url || 'Unknown'}

${isParent ? 
  `As a parent, provide 3-5 detailed, actionable recommendations on how to address this incident with your child. Include:
1. Immediate steps to take
2. How to have the conversation with your child
3. Preventive measures for the future
4. When to seek professional help if needed
5. How to monitor similar situations

Be empathetic, practical, and focus on maintaining trust while ensuring safety.` 
  : 
  `As a child or teen, provide 3-5 clear, age-appropriate steps on what to do about this incident. Include:
1. Immediate actions to stay safe
2. Who to talk to and how to explain what happened
3. Why this content was blocked (in simple terms)
4. How to avoid similar situations
5. Reassurance that they did nothing wrong

Use simple, supportive language that doesn't cause fear but promotes awareness.`
}

Format your response with clear numbered points and brief explanations for each recommendation.`;

      // Call backend Gemini endpoint
      const response = await fetch('http://localhost:8000/ai-recommendations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          category: category,
          user_type: userType,
          severity: severity
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get AI recommendations');
      }

      const data = await response.json();
      setAiRecommendations(data.recommendations || data.response || 'Unable to generate recommendations at this time.');
    } catch (error) {
      console.error('Error fetching AI recommendations:', error);
      setAiError('Unable to generate recommendations. Please try again later.');
      // Fallback to default recommendations
      setAiRecommendations(getDefaultRecommendations(report.category, isParent));
    } finally {
      setLoadingAI(false);
    }
  };

  const getDefaultRecommendations = (category, isParentView) => {
    if (isParentView) {
      return `1. Have an open, non-judgmental conversation with your child about what happened.\n\n2. Review and adjust your family's online safety rules and device settings.\n\n3. Stay engaged with their online activities and maintain open communication.\n\n4. Consider consulting with a professional if the incident has caused distress.`;
    } else {
      return `1. Tell a trusted adult (parent, teacher, or guardian) about what happened.\n\n2. You did nothing wrong - this content appeared unexpectedly.\n\n3. Block and report any suspicious accounts or content.\n\n4. Continue being careful about what you click and who you talk to online.`;
    }
  };

  const closeAIModal = () => {
    setShowAIRecommendations(false);
    setSelectedReport(null);
    setAiRecommendations('');
    setAiError(null);
  };

  const getRecommendedSteps = (category, isParentView) => {
    if (isParentView) {
      // Detailed actions for parents
      const parentActions = {
        explicit_content: [
          { icon: '💬', title: 'Have an Open Conversation', description: 'Talk to your child about what they saw and why it was blocked. Create a safe space for them to ask questions without fear of punishment.' },
          { icon: '📱', title: 'Review Device Settings', description: 'Check privacy settings, screen time limits, and ensure parental controls are properly configured across all their devices.' },
          { icon: '📚', title: 'Educate on Appropriate Content', description: 'Discuss age-appropriate content and help them understand why certain content is restricted for their protection.' }
        ],
        scam: [
          { icon: '🛡️', title: 'Educate on Scam Recognition', description: 'Teach your child how to identify common scam tactics like too-good-to-be-true offers, urgent requests for information, and suspicious links.' },
          { icon: '💰', title: 'Discuss Financial Safety', description: 'Explain why they should never share payment information, gift card codes, or make purchases without your explicit permission.' },
          { icon: '📞', title: 'Report if Necessary', description: 'If money was involved or personal information was shared, report to local authorities and the platform where the scam occurred.' }
        ],
        predatory: [
          { icon: '🚨', title: 'Contact Authorities Immediately', description: 'Report to local law enforcement and the National Center for Missing & Exploited Children (1-800-843-5678). This is a serious threat requiring immediate action.' },
          { icon: '📸', title: 'Preserve Evidence', description: 'Take screenshots of all communications and save messages. Do not delete anything that could be used as evidence in an investigation.' },
          { icon: '🔒', title: 'Secure All Accounts', description: 'Change passwords, review privacy settings, and temporarily restrict your child\'s online access if needed until the situation is resolved.' }
        ],
        violence: [
          { icon: '🎮', title: 'Discuss Content Consumption', description: 'Talk about the difference between fictional violence in games/movies and real-world consequences. Set clear boundaries about acceptable content.' },
          { icon: '🧠', title: 'Monitor Mental Health', description: 'Check in on how violent content affects them emotionally. Consider limiting exposure if you notice behavioral changes or nightmares.' },
          { icon: '⚠️', title: 'Set Clear Boundaries', description: 'Establish rules about what content is acceptable for their age and enforce consequences for accessing restricted material.' }
        ],
        hate_speech: [
          { icon: '❤️', title: 'Address Respectful Communication', description: 'Discuss empathy, respect, and the real impact of hateful language on individuals and communities.' },
          { icon: '🚫', title: 'Report and Block', description: 'Report the content to the platform and block users spreading hate speech. Explain why this behavior is unacceptable.' },
          { icon: '🤝', title: 'Promote Inclusivity', description: 'Reinforce values of acceptance and kindness. Discuss how to stand up against discrimination safely.' }
        ],
        default: [
          { icon: '👥', title: 'Review with Your Child', description: 'Discuss what happened and why the content was flagged. Ensure they understand online safety without feeling shamed.' },
          { icon: '🔧', title: 'Adjust Protection Settings', description: 'Review and update filtering rules based on this incident to prevent similar content in the future.' },
          { icon: '📅', title: 'Schedule Regular Check-ins', description: 'Make online safety discussions a regular part of family conversations, not just when problems arise.' }
        ]
      };
      return parentActions[category] || parentActions.default;
    } else {
      // Detailed guidance for children
      const childGuidance = {
        explicit_content: [
          { icon: '🗣️', title: 'Tell a Trusted Adult', description: 'Share what you saw with a parent, guardian, teacher, or another trusted adult. You are not in trouble - they want to help keep you safe.' },
          { icon: '❌', title: 'Do Not Search for Similar Content', description: 'Avoid trying to find or view similar content. Sentry blocked it to protect you, and seeking it out could expose you to more harmful material.' },
          { icon: '✅', title: 'You Did Nothing Wrong', description: 'Sometimes inappropriate content appears unexpectedly. You did the right thing by not engaging with it.' }
        ],
        scam: [
          { icon: '🛑', title: 'Do Not Respond or Click', description: 'Never reply to suspicious messages or click on links offering prizes, free items, or asking for personal information. Delete or ignore them immediately.' },
          { icon: '🔐', title: 'Never Share Personal Information', description: 'Do not give out your name, address, phone number, school name, parents\' information, or any passwords to strangers online.' },
          { icon: '👨‍👩‍👧', title: 'Tell Your Parents', description: 'Show the message to your parents or guardian. They can help determine if it\'s safe and what to do next.' }
        ],
        predatory: [
          { icon: '🚨', title: 'Tell a Parent Immediately', description: 'This is very serious. Tell your parent or guardian right now. You are safe and not in trouble - adults are here to protect you.' },
          { icon: '🚫', title: 'Stop All Contact', description: 'Do not respond to any more messages from this person. Block them on all platforms immediately.' },
          { icon: '💪', title: 'You Are Brave', description: 'Speaking up about this takes courage. Adults will handle this situation and make sure you stay safe.' }
        ],
        violence: [
          { icon: '👁️', title: 'It\'s Okay to Look Away', description: 'If something disturbing appears, it\'s okay to close it immediately. You do not have to watch or view violent content.' },
          { icon: '😟', title: 'Talk About Your Feelings', description: 'If violent content upset you, talk to a trusted adult about how you feel. It\'s normal to feel scared or uncomfortable.' },
          { icon: '🎮', title: 'Choose Age-Appropriate Content', description: 'Stick to games, shows, and websites designed for your age group. They\'re more fun and safer for you.' }
        ],
        hate_speech: [
          { icon: '💔', title: 'You Are Not Alone', description: 'Hateful words can hurt deeply. Remember that you are valued, loved, and important no matter what anyone says.' },
          { icon: '🚫', title: 'Block and Report', description: 'Block the person and report their account to the platform. You do not have to read or see hateful messages.' },
          { icon: '🗣️', title: 'Talk to Someone', description: 'Share how you feel with a trusted adult. They can help you process these feelings and stay strong.' }
        ],
        default: [
          { icon: '✅', title: 'You Did Nothing Wrong', description: 'Sentry blocked this content to protect you. You are not in trouble for encountering it - this is exactly how the system should work.' },
          { icon: '👨‍👩‍👧', title: 'Tell a Trusted Adult', description: 'Share what happened with a parent, teacher, or guardian. They are here to help and support you.' },
          { icon: '🛡️', title: 'Stay Safe Online', description: 'Continue being careful online. Sentry and your family are working together to keep you safe while you explore the internet.' }
        ]
      };
      return childGuidance[category] || childGuidance.default;
    }
  };

  return (
    <div className="safety-reports-container">
      <div className="safety-reports-header">
        <h2>Safety Reports</h2>
        <p className="safety-reports-subtitle">
          {isParent 
            ? 'Monitoring all family members for online safety' 
            : 'Your personal safety activity log'}
        </p>
      </div>

      {/* Search and Filter Controls */}
      <div className="reports-controls">
        {isParent && (
          <div className="search-bar">
            <i className='bx bx-search'></i>
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                <i className='bx bx-x'></i>
              </button>
            )}
          </div>
        )}
        
        <div className="date-filter">
          <i className='bx bx-calendar'></i>
          <select 
            value={dateFilter} 
            onChange={(e) => setDateFilter(e.target.value)}
            className="date-select"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Past Week</option>
            <option value="month">Past Month</option>
          </select>
        </div>
      </div>

      {sortedReports.length === 0 ? (
        <div className="safety-reports-empty">
          <i className='bx bx-shield-alt-2'></i>
          <h3>No Safety Reports</h3>
          <p>Great job! No concerning content has been detected.</p>
        </div>
      ) : (
        <div className="safety-reports-table-wrapper">
          <table className="safety-reports-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Title</th>
                <th>Transgression</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedReports.map((report, index) => {
                const eventId = report.event_id || `event-${index}`;
                const userName = report.user_name || report.user_id || 'Unknown User';
                const title = report.title || report.summary || 'Flagged Content';
                const category = report.category || 'unsafe_content';
                
                return (
                  <tr key={eventId} className="safety-report-row">
                    <td className="report-date">
                      {formatDate(report.detected_at)}
                    </td>
                    <td className="report-user">
                      <div className="user-badge">
                        <i className='bx bx-user-circle'></i>
                        <span>{userName}</span>
                      </div>
                    </td>
                    <td className="report-title">
                      <button 
                        className="title-button"
                        onClick={() => handleShowDetails(report)}
                        title="Click to view full details"
                      >
                        {isParent ? title : '••••••••'} {/* Censor for children */}
                        <i className='bx bx-right-arrow-alt'></i>
                      </button>
                    </td>
                    <td className="report-transgression">
                      <span className={`transgression-badge transgression-${category}`}>
                        <span className="transgression-icon">{getCategoryIcon(category)}</span>
                        {getCategoryLabel(category)}
                      </span>
                    </td>
                    <td className="report-actions">
                      <button 
                        className="ai-recommendations-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGetAIRecommendations(report);
                        }}
                        title="Get AI-powered recommendations"
                      >
                        <i className='bx bx-brain'></i>
                        AI Recommendations
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Details Modal */}
      {showDetailsModal && selectedReport && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>
              <i className='bx bx-x'></i>
            </button>

            <div className="modal-header">
              <span className={`transgression-badge transgression-${selectedReport.category}`}>
                <span className="transgression-icon">{getCategoryIcon(selectedReport.category)}</span>
                {getCategoryLabel(selectedReport.category)}
              </span>
              <span className="modal-date">{formatDate(selectedReport.detected_at)}</span>
            </div>

            <h2 className="modal-title">
              {isParent ? (selectedReport.title || selectedReport.summary) : 'Safety Alert Details'}
            </h2>

            <div className="modal-body">
              <div className="modal-section">
                <h3>What Happened</h3>
                <p>{isParent ? selectedReport.reason : 'Content was blocked for your safety.'}</p>
              </div>

              {isParent && selectedReport.content_excerpt && (
                <div className="modal-section">
                  <h3>Content Preview</h3>
                  <div className="content-preview">
                    {selectedReport.content_excerpt}
                  </div>
                </div>
              )}

              {isParent && selectedReport.screenshot && (
                <div className="modal-section">
                  <h3>Screenshot</h3>
                  <img 
                    src={selectedReport.screenshot} 
                    alt="Screenshot of blocked content" 
                    className="modal-screenshot"
                  />
                </div>
              )}

              <div className="modal-section">
                <h3>Source</h3>
                <a 
                  href={selectedReport.page_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="source-link"
                >
                  <i className='bx bx-link-external'></i>
                  {selectedReport.page_url || 'Unknown source'}
                </a>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Recommendations Modal */}
      {showAIRecommendations && selectedReport && (
        <div className="modal-overlay" onClick={closeAIModal}>
          <div className="ai-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeAIModal}>
              <i className='bx bx-x'></i>
            </button>

            <div className="ai-modal-header">
              <div className="ai-icon">
                <i className='bx bx-brain'></i>
              </div>
              <h2>AI-Powered Recommendations</h2>
              <span className={`transgression-badge transgression-${selectedReport.category}`}>
                <span className="transgression-icon">{getCategoryIcon(selectedReport.category)}</span>
                {getCategoryLabel(selectedReport.category)}
              </span>
            </div>

            <div className="ai-modal-body">
              {loadingAI ? (
                <div className="ai-loading">
                  <div className="loading-spinner"></div>
                  <p>Generating personalized recommendations...</p>
                </div>
              ) : aiError ? (
                <div className="ai-error">
                  <i className='bx bx-error-circle'></i>
                  <p>{aiError}</p>
                </div>
              ) : (
                <div className="ai-recommendations-content">
                  <div className="ai-context-info">
                    <p><strong>Incident:</strong> {selectedReport.title || selectedReport.summary}</p>
                    <p><strong>For:</strong> {isParent ? 'Parents/Guardians' : 'You'}</p>
                  </div>
                  <div className="ai-recommendations-text">
                    {aiRecommendations.split('\n').map((line, idx) => (
                      <p key={idx}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="ai-modal-footer">
              <button className="btn-primary" onClick={closeAIModal}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SafetyReports;
