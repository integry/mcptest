import React from 'react';

const DashboardDemo: React.FC = () => {
  return (
    <div className="container-fluid p-4">
      <div className="row mb-4">
        <div className="col-12">
          <h2 className="mb-3">Dashboard Demo - Data Able Style</h2>
          <p className="text-muted">
            This demo showcases the new dashboard styling inspired by the Data Able admin template.
          </p>
        </div>
      </div>

      {/* Metrics Cards Row */}
      <div className="row mb-4">
        <div className="col-md-4">
          <div className="dashboard-metrics-card">
            <div className="dashboard-metric-value text-success">
              ↗ $249.95
            </div>
            <div className="dashboard-metric-label">Daily Sales</div>
            <div className="dashboard-progress-bar">
              <div className="dashboard-progress-fill cyan" style={{ width: '67%' }}></div>
            </div>
            <div className="d-flex justify-content-between align-items-center">
              <small className="text-muted">Target 32.54%</small>
              <small className="text-muted">67%</small>
            </div>
          </div>
        </div>
        
        <div className="col-md-4">
          <div className="dashboard-metrics-card">
            <div className="dashboard-metric-value text-danger">
              ↘ $2,942.32
            </div>
            <div className="dashboard-metric-label">Monthly Sales</div>
            <div className="dashboard-progress-bar">
              <div className="dashboard-progress-fill purple" style={{ width: '56%' }}></div>
            </div>
            <div className="d-flex justify-content-between align-items-center">
              <small className="text-muted">Target 62.50%</small>
              <small className="text-muted">56%</small>
            </div>
          </div>
        </div>
        
        <div className="col-md-4">
          <div className="dashboard-metrics-card">
            <div className="dashboard-metric-value text-success">
              ↗ $8,638.32
            </div>
            <div className="dashboard-metric-label">Yearly Sales</div>
            <div className="dashboard-progress-bar">
              <div className="dashboard-progress-fill success" style={{ width: '80%' }}></div>
            </div>
            <div className="d-flex justify-content-between align-items-center">
              <small className="text-muted">Target 75.00%</small>
              <small className="text-muted">80%</small>
            </div>
          </div>
        </div>
      </div>

      {/* Social Media Widgets and User List Row */}
      <div className="row mb-4">
        <div className="col-md-8">
          <div className="card">
            <div className="card-header">
              <h5 className="mb-0">Recent Users</h5>
            </div>
            <div className="card-body p-0">
              <div className="dashboard-user-list">
                <div className="dashboard-user-item">
                  <div className="dashboard-user-avatar" style={{ backgroundColor: '#3498db' }}></div>
                  <div className="dashboard-user-info">
                    <div className="dashboard-user-name">Isabella Christensen</div>
                    <div className="dashboard-user-meta">Lorem ipsum is simply dummy text of...</div>
                  </div>
                  <div className="text-end">
                    <small className="text-muted">11 MAY 12:56</small>
                    <div className="mt-1">
                      <span className="badge bg-primary">React</span>
                      <span className="badge bg-success ms-1">Angular</span>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-user-item">
                  <div className="dashboard-user-avatar" style={{ backgroundColor: '#e74c3c' }}></div>
                  <div className="dashboard-user-info">
                    <div className="dashboard-user-name">Mathilde Andersen</div>
                    <div className="dashboard-user-meta">Lorem ipsum is simply dummy text of...</div>
                  </div>
                  <div className="text-end">
                    <small className="text-muted">11 MAY 10:35</small>
                    <div className="mt-1">
                      <span className="badge bg-primary">React</span>
                      <span className="badge bg-success ms-1">Angular</span>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-user-item">
                  <div className="dashboard-user-avatar" style={{ backgroundColor: '#27ae60' }}></div>
                  <div className="dashboard-user-info">
                    <div className="dashboard-user-name">Karla Sorensen</div>
                    <div className="dashboard-user-meta">Lorem ipsum is simply dummy text of...</div>
                  </div>
                  <div className="text-end">
                    <small className="text-muted">9 MAY 17:38</small>
                    <div className="mt-1">
                      <span className="badge bg-primary">React</span>
                      <span className="badge bg-success ms-1">Angular</span>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-user-item">
                  <div className="dashboard-user-avatar" style={{ backgroundColor: '#f39c12' }}></div>
                  <div className="dashboard-user-info">
                    <div className="dashboard-user-name">Ida Jorgensen</div>
                    <div className="dashboard-user-meta">Lorem ipsum is simply dummy text of...</div>
                  </div>
                  <div className="text-end">
                    <small className="text-muted">19 MAY 12:56</small>
                    <div className="mt-1">
                      <span className="badge bg-primary">React</span>
                      <span className="badge bg-success ms-1">Angular</span>
                    </div>
                  </div>
                </div>
                
                <div className="dashboard-user-item">
                  <div className="dashboard-user-avatar" style={{ backgroundColor: '#9b59b6' }}></div>
                  <div className="dashboard-user-info">
                    <div className="dashboard-user-name">Albert Andersen</div>
                    <div className="dashboard-user-meta">Lorem ipsum is simply dummy text of...</div>
                  </div>
                  <div className="text-end">
                    <small className="text-muted">21 July 12:56</small>
                    <div className="mt-1">
                      <span className="badge bg-primary">React</span>
                      <span className="badge bg-success ms-1">Angular</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="col-md-4">
          {/* Social Media Widgets */}
          <div className="dashboard-social-widget facebook">
            <div className="dashboard-social-icon">📘</div>
            <div className="dashboard-social-count">12,281</div>
            <div className="dashboard-social-label">+2.2% Total Likes</div>
          </div>
          
          <div className="dashboard-social-widget twitter">
            <div className="dashboard-social-icon">🐦</div>
            <div className="dashboard-social-count">11,200</div>
            <div className="dashboard-social-label">+6.2% Total Likes</div>
          </div>
          
          <div className="dashboard-social-widget google">
            <div className="dashboard-social-icon">🔴</div>
            <div className="dashboard-social-count">10,500</div>
            <div className="dashboard-social-label">+5.9% Total Likes</div>
          </div>
        </div>
      </div>

      {/* Rating Widget */}
      <div className="row">
        <div className="col-md-6">
          <div className="dashboard-rating-widget">
            <div className="text-center mb-3">
              <h5 className="mb-2">Rating</h5>
              <div className="dashboard-rating-score">4.7</div>
              <div className="dashboard-rating-stars">★ ★ ★ ★ ★</div>
            </div>
            
            <div className="dashboard-rating-breakdown">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>★ 5</span>
                <div className="dashboard-rating-bar flex-grow-1 mx-2">
                  <div className="dashboard-rating-bar-fill" style={{ width: '85%' }}></div>
                </div>
                <span className="text-muted">364</span>
              </div>
              
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>★ 4</span>
                <div className="dashboard-rating-bar flex-grow-1 mx-2">
                  <div className="dashboard-rating-bar-fill" style={{ width: '70%' }}></div>
                </div>
                <span className="text-muted">145</span>
              </div>
              
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>★ 3</span>
                <div className="dashboard-rating-bar flex-grow-1 mx-2">
                  <div className="dashboard-rating-bar-fill" style={{ width: '40%' }}></div>
                </div>
                <span className="text-muted">24</span>
              </div>
              
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span>★ 2</span>
                <div className="dashboard-rating-bar flex-grow-1 mx-2">
                  <div className="dashboard-rating-bar-fill" style={{ width: '15%' }}></div>
                </div>
                <span className="text-muted">1</span>
              </div>
              
              <div className="d-flex justify-content-between align-items-center">
                <span>★ 1</span>
                <div className="dashboard-rating-bar flex-grow-1 mx-2">
                  <div className="dashboard-rating-bar-fill" style={{ width: '5%' }}></div>
                </div>
                <span className="text-muted">0</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="col-md-6">
          <div className="card">
            <div className="card-header">
              <h5 className="mb-0">System Information</h5>
            </div>
            <div className="card-body">
              <p>This is a demonstration of the new dashboard styling based on the Data Able admin template design.</p>
              
              <h6>Features Implemented:</h6>
              <ul>
                <li>Light theme with professional color palette</li>
                <li>Dark sidebar navigation</li>
                <li>Metrics cards with progress indicators</li>
                <li>Social media widgets</li>
                <li>User list with avatars and badges</li>
                <li>Rating system with visual breakdown</li>
                <li>Responsive grid layout</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardDemo;