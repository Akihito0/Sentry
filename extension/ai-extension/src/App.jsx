import { useState } from "react";
import { askAI } from "./ai"; // Import the Gemini AI helper

function App() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");

  async function handleAsk() {
    if (input.trim() === "") return;
    setOutput("Thinking... 🤖");

    const res = await askAI(input);
    setOutput(res);
  }

  return (
    <div style={{ padding: "1rem", width: "250px", fontFamily: "sans-serif" }}>
      <h3 style={{ marginBottom: "0.5rem" }}>AI Extension</h3>

      <input
        type="text"
        placeholder="Ask me something..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{
          width: "100%",
          marginBottom: "0.5rem",
          padding: "0.3rem",
          borderRadius: "5px",
          border: "1px solid #ccc",
        }}
      />

      <button
        onClick={handleAsk}
        style={{
          width: "100%",
          padding: "0.4rem",
          borderRadius: "5px",
          backgroundColor: "#4cafef",
          border: "none",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        Ask AI
      </button>

      <p
        style={{
          marginTop: "0.8rem",
          whiteSpace: "pre-wrap",
          fontSize: "0.9rem",
        }}
      >
        {output}
      </p>
    </div>
  );
}

export default App;
