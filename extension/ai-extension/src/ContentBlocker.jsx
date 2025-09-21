import React from "react";
import "./ContentBlocker.css";

function ContentBlocker({ reason, onGoBack, onAskParent }) {
  return (
    <div className="sentry-block-popup">
      <div className="sentry-block-logo-section">
        <img
          src="/images/SENTRY_LOGO_TEMP.png"
          alt="Sentry Logo"
          className="sentry-block-logo"
        />
      </div>
      <h2 className="sentry-block-title">Content Alert</h2>
      <p className="sentry-block-reason">
        <strong>Inappropriate content detected:</strong>
        <br />
        <span className="sentry-block-reason-text">{reason}</span>
      </p>
      <p className="sentry-block-info">
        For your safety, this content has been blocked. If you think this is a mistake, you can ask a parent to unlock it.
      </p>
      <div className="sentry-block-actions">
        <button className="sentry-block-btn" onClick={onGoBack}>
          Go Back
        </button>
        <button className="sentry-block-btn parent-btn" onClick={onAskParent}>
          Ask Parent to unlock
        </button>
      </div>
    </div>
  );
}

export default ContentBlocker;