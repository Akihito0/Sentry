import React, { useMemo, useState } from 'react'
import logo from '../image/logo.png'
import profile from '../image/profile.png'

const Sidebar = ({ active, setActive, isOpen, close }) => {
  const items = useMemo(() => [
    { icon: 'bx bx-home-alt-2', label: 'Overview' },
    { icon: 'bx bx-grid-alt', label: 'Account Manager' },
    { icon: 'bx bx-cog', label: 'Setting' },
  ], [])

  return (
    <aside className="left-section" style={{ top: isOpen ? '0' : undefined }}>
      <div className="logo">
        <button className="menu-btn" id="menu-close" onClick={close}>
          <i className='bx bx-log-out-circle'></i>
        </button>
        <img src={logo} />
        <a href="#">Sentry</a>
      </div>

      <div className="sidebar">
        {items.map((item, idx) => (
          <div key={item.label} className="item" id={active === idx ? 'active' : undefined} onClick={() => setActive(idx)}>
            <i className={item.icon}></i>
            <a href="#">{item.label}</a>
          </div>
        ))}
      </div>
    </aside>
  )
}

const RightSection = () => {
  return (
    <aside className="right-section">
      <div className="top">
        <div className="profile">
          <div className="left">
            <img src={profile} />
            <div className="user">
              <h2>UserName</h2>
            </div>
          </div>
        </div>
      </div>

      <div className="separator" id="first">
        <h4>AI Report</h4>
      </div>

      <div className="stats">
        <div className="item">
          <div className="top">
            <p>Explicit Words</p>
            <p>Blocked:</p>
          </div>
          <div className="bottom">
            <div className="line"></div>
            <h3>25</h3>
          </div>
        </div>
        <div className="item">
          <div className="top">
            <p>Potential Scams</p>
            <p>Detected:</p>
          </div>
          <div className="bottom">
            <div className="line"></div>
            <h3>3</h3>
          </div>
        </div>
      </div>

      <div className="separator">
        <h4>Harmful Websites Visited:</h4>
      </div>

      <div className="weekly">
        <div className="title">
          <div className="line"></div>
          <h5>www.facebook.com</h5>
        </div>
      </div>
    </aside>
  )
}

const Main = ({ openMenu }) => {
  return (
    <main>
      <header>
        <button className="menu-btn" id="menu-open" onClick={openMenu}>
          <i className='bx bx-menu'></i>
        </button>
        <h5>Hello <b>UserName</b>, Welcome back!</h5>
      </header>

      <div className="separator">
        <div className="info">
          <h3>Overview</h3>
        </div>
      </div>

      <div className="analytics">
        <div className="item">
          <div className="progress">
            <div className="info">
              <h5>Blocked Websites:</h5>
            </div>
          </div>
        </div>
        <div className="item">
          <div className="progress">
            <div className="info">
              <h5>Phishing Attempts:</h5>
            </div>
          </div>
        </div>
        <div className="item">
          <div className="progress">
            <div className="info">
              <h5>Family Count: </h5>
            </div>
          </div>
        </div>
        <div className="item">
          <div className="progress">
            <div className="info">
              <h5>Blocked Scams:</h5>
            </div>
          </div>
        </div>
      </div>

      <div className="separator">
        <div className="info">
          <h3>Family Members:</h3>
        </div>
        <input type="date" defaultValue="2025-10-15" />
      </div>

      <div className="planning">
        {['Noah Gabby', 'Jordii Cabs', 'Karlo Gon'].map(name => (
          <div className="item" key={name}>
            <div className="left">
              <div className="details">
                <h5>{name}</h5>
              </div>
            </div>
            <i className='bx bx-dots-vertical-rounded'></i>
          </div>
        ))}
      </div>
    </main>
  )
}

const DashboardView = () => {
  const [active, setActive] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="container">
      <Sidebar active={active} setActive={setActive} isOpen={sidebarOpen} close={() => setSidebarOpen(false)} />
      <Main openMenu={() => setSidebarOpen(true)} />
      <RightSection />
    </div>
  )
}

export default DashboardView


