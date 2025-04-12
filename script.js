document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const serverUrlInput = document.getElementById('serverUrl');
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const listToolsBtn = document.getElementById('listToolsBtn');
    const toolsList = document.getElementById('toolsList');
    const toolParams = document.getElementById('toolParams');
    const executeToolBtn = document.getElementById('executeToolBtn');
    const responseArea = document.getElementById('responseArea');
    const clearResponseBtn = document.getElementById('clearResponseBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const autoScrollSwitch = document.getElementById('autoScrollSwitch');

    // State
    let sessionId = null;
    let eventSource = null;
    let selectedTool = null;
    let availableTools = [];
    let toolsMap = {};
    let currentRequestId = 1;
    let lastEventId = null;

    // Initialize with default URL if empty
    if (!serverUrlInput.value) {
        serverUrlInput.value = window.location.protocol + '//' + window.location.hostname + ':3033';
    }

    // Connect to MCP server using HTTP Stream Transport
    connectBtn.addEventListener('click', async () => {
        // Disable buttons during connection
        connectBtn.disabled = true;
        disconnectBtn.disabled = true;
        listToolsBtn.disabled = true;
        
        try {
            const serverUrl = serverUrlInput.value.trim();
            if (!serverUrl) {
                createResponseElement('Error: Please enter a server URL', 'error-message');
                return;
            }

            // Clear previous state
            toolsList.innerHTML = '';
            toolParams.innerHTML = '<p class="text-muted">Select a tool to see its parameters</p>';
            selectedTool = null;
            availableTools = [];
            toolsMap = {};
            sessionId = null;
            executeToolBtn.disabled = true;

            // Update UI
            connectionStatus.textContent = 'Connecting...';
            connectionStatus.className = 'badge bg-warning';
            connectBtn.disabled = true;

            // Determine the MCP endpoint
            const mcpEndpoint = `${serverUrl}/mcp`;
            createResponseElement(`Initializing connection to ${mcpEndpoint}...`, 'info-message');
            
            // Create initialization request
            const initRequest = {
                jsonrpc: "2.0",
                id: `req_${currentRequestId++}`,
                method: "initialize",
                params: {
                    clientInfo: {
                        name: "MCP HTTP Stream Tester",
                        version: "1.0.0"
                    },
                    capabilities: {
                        streaming: true,
                        batch_support: true
                    },
                    protocolVersion: "2025-03-26"
                }
            };
            
            console.log("DEBUG: Initialization request:", JSON.stringify(initRequest, null, 2));
            
            // Send initialization request
            try {
                const response = await fetch(mcpEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream'
                    },
                    body: JSON.stringify(initRequest)
                });
                
                console.log("DEBUG: Response status:", response.status);
                console.log("DEBUG: Response headers:", [...response.headers.entries()]);
                
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                
                // Get session ID from response headers
                sessionId = response.headers.get('Mcp-Session-Id');
                if (!sessionId) {
                    createResponseElement('Warning: No session ID received from server', 'error-message');
                } else {
                    createResponseElement(`Session established: ${sessionId}`, 'success-message');
                }
                
                // Check the content type to determine how to handle the response
                const contentType = response.headers.get('Content-Type');
                console.log("DEBUG: Response Content-Type:", contentType);
                
                if (contentType && contentType.includes('text/event-stream')) {
                    // Handle event stream response
                    createResponseElement("Received event stream response for initialization", 'info-message');
                    
                    // Create a reader to read the response body
                    const reader = response.body.getReader();
                    let decoder = new TextDecoder();
                    let buffer = '';
                    
                    // Read the first chunk to get the initialization response
                    const { value, done } = await reader.read();
                    if (!done) {
                        const chunk = decoder.decode(value, { stream: true });
                        buffer += chunk;
                        
                        console.log("DEBUG: SSE chunk:", buffer);
                        
                        // Extract the data from the SSE format
                        // SSE format is: "event: message\ndata: {...}\n\n"
                        const dataMatch = buffer.match(/data: (.*?)(\n\n|\n$)/s);
                        if (dataMatch && dataMatch[1]) {
                            try {
                                const jsonData = JSON.parse(dataMatch[1]);
                                console.log("DEBUG: Parsed SSE data:", jsonData);
                                createResponseElement(`Initialization result: ${JSON.stringify(jsonData, null, 2)}`, 'success-message');
                            } catch (parseError) {
                                console.error("DEBUG: Error parsing SSE data:", parseError);
                                createResponseElement(`Raw SSE data (not parsed): ${dataMatch[1]}`, 'debug-message');
                            }
                        } else {
                            console.log("DEBUG: Could not extract data from SSE chunk");
                            createResponseElement(`Raw SSE chunk: ${buffer}`, 'debug-message');
                        }
                    }
                    
                    // We've already started reading the event stream, so we'll continue
                    // with the existing connection rather than creating a new EventSource
                    createResponseElement('Using the existing event stream connection', 'info-message');
                    
                    // Continue reading the stream in the background
                    processEventStream(reader, decoder);
                    
                } else {
                    // Handle JSON response
                    console.log("DEBUG: Response is JSON");
                    
                    // Process the response
                    const result = await response.json();
                    
                    console.log("DEBUG: Response JSON:", JSON.stringify(result, null, 2));
                    
                    createResponseElement(`Initialization result: ${JSON.stringify(result, null, 2)}`, 'success-message');
                    
                    // Since we got a JSON response, we need to open a separate event stream
                    openEventStream(mcpEndpoint);
                }
            
            } catch (fetchError) {
                console.error("DEBUG: Fetch or parsing error:", fetchError);
                createResponseElement(`Error creating connection: ${fetchError.message}`, 'error-message');
                throw fetchError; // Re-throw to be caught by the outer try-catch
            }
            
            // Update UI
            connectionStatus.textContent = 'Connected';
            connectionStatus.className = 'badge bg-success';
            disconnectBtn.disabled = false;
            listToolsBtn.disabled = false;
            
        } catch (error) {
            createResponseElement(`Error creating connection: ${error.message}`, 'error-message');
            connectionStatus.textContent = 'Error';
            connectionStatus.className = 'badge bg-danger';
            connectBtn.disabled = false;
        }
    });

    // Disconnect from MCP server
    disconnectBtn.addEventListener('click', async () => {
        await terminateSession();
    });
    
    // Terminate the MCP session
    async function terminateSession() {
        if (!sessionId) {
            disconnectEventSource();
            return;
        }
        
        disconnectEventSource();
        
        try {
            const serverUrl = serverUrlInput.value.trim();
            const mcpEndpoint = `${serverUrl}/mcp`;
            
            const terminateRequest = {
                jsonrpc: "2.0",
                id: `term-${Date.now()}`,
                method: "terminate",
                params: {}
            };
            
            await fetch(mcpEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionId
                },
                body: JSON.stringify(terminateRequest)
            });
        } catch (error) {
            createResponseElement(`Error terminating session: ${error.message}`, 'error-message');
        }
        
        sessionId = null;
        lastEventId = null;
        
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'badge bg-secondary';
        connectBtn.disabled = false;
        disconnectBtn.disabled = true;
        executeToolBtn.disabled = true;
    }
    
    // Helper function to disconnect EventSource
    function disconnectEventSource() {
        if (eventSource) {
            try {
                eventSource.close();
            } catch (e) {
                console.error("Error closing event source:", e);
            }
            eventSource = null;
        }
    }

    // Process tools list
    function processToolsList(tools) {
        if (!Array.isArray(tools) || tools.length === 0) {
            createResponseElement('No tools available', 'warning-message');
            toolsList.innerHTML = '<li class="list-group-item">No tools available</li>';
            return;
        }

        createResponseElement(`Received ${tools.length} tools`, 'success-message');
        addDebugInfo(`Tools response: ${JSON.stringify(tools, null, 2)}`);

        availableTools = tools;
        toolsMap = {};
        
        // Create a map of tool names to tool objects for easy lookup
        tools.forEach(tool => {
            toolsMap[tool.name] = tool;
        });
        
        // Sort tools alphabetically by name
        tools.sort((a, b) => a.name.localeCompare(b.name));
        
        // Clear and populate the tools list
        toolsList.innerHTML = '';
        tools.forEach(tool => {
            const li = document.createElement('li');
            li.className = 'list-group-item tool-item';
            li.textContent = tool.name;
            li.dataset.toolName = tool.name;
            li.addEventListener('click', () => selectTool(tool.name));
            toolsList.appendChild(li);
        });
    }

    // Select a tool and display its parameters
    function selectTool(toolName) {
        // Clear previous selection
        document.querySelectorAll('.tool-item.active').forEach(el => {
            el.classList.remove('active');
        });
        
        // Highlight selected tool
        const toolItem = document.querySelector(`.tool-item[data-tool-name="${toolName}"]`);
        if (toolItem) {
            toolItem.classList.add('active');
        }
        
        selectedTool = toolsMap[toolName];
        
        if (!selectedTool) {
            createResponseElement(`Tool not found: ${toolName}`, 'error-message');
            return;
        }
        
        // Display tool parameters
        toolParams.innerHTML = '';
        
        const nameHeader = document.createElement('h5');
        nameHeader.textContent = selectedTool.name;
        toolParams.appendChild(nameHeader);
        
        if (selectedTool.description) {
            const description = document.createElement('p');
            description.className = 'text-muted';
            description.textContent = selectedTool.description;
            toolParams.appendChild(description);
        }
        
        // Create form for parameters
        const form = document.createElement('form');
        form.id = 'tool-params-form';
        
        // Check for parameters in different formats
        let hasParameters = false;
        let parameters = {};
        
        // Check for inputSchema format (standard MCP format)
        if (selectedTool.inputSchema && selectedTool.inputSchema.properties) {
            hasParameters = true;
            parameters = selectedTool.inputSchema.properties;
            const requiredParams = selectedTool.inputSchema.required || [];
            
            const paramsTitle = document.createElement('h6');
            paramsTitle.textContent = 'Parameters:';
            paramsTitle.className = 'mt-3';
            form.appendChild(paramsTitle);
            
            Object.entries(parameters).forEach(([paramName, paramInfo]) => {
                const formGroup = document.createElement('div');
                formGroup.className = 'mb-3';
                
                const label = document.createElement('label');
                label.htmlFor = `param-${paramName}`;
                label.className = 'form-label';
                label.textContent = paramName;
                
                if (paramInfo.description) {
                    const small = document.createElement('small');
                    small.className = 'd-block text-muted';
                    small.textContent = paramInfo.description;
                    label.appendChild(small);
                }
                
                if (requiredParams.includes(paramName)) {
                    label.innerHTML += ' <span class="text-danger">*</span>';
                }
                
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'form-control';
                input.id = `param-${paramName}`;
                input.name = paramName;
                input.dataset.paramName = paramName;
                
                if (paramInfo.type === 'object') {
                    input.placeholder = '{"key": "value"}';
                    const helpText = document.createElement('small');
                    helpText.className = 'form-text text-muted';
                    helpText.textContent = 'Enter as JSON object: {"key": "value"}';
                    formGroup.appendChild(label);
                    formGroup.appendChild(input);
                    formGroup.appendChild(helpText);
                } else if (paramInfo.type === 'array') {
                    input.placeholder = 'value1, value2, value3';
                    const helpText = document.createElement('small');
                    helpText.className = 'form-text text-muted';
                    helpText.textContent = 'Enter multiple values separated by commas, or as a JSON array: ["value1", "value2"]';
                    formGroup.appendChild(label);
                    formGroup.appendChild(input);
                    formGroup.appendChild(helpText);
                } else {
                    formGroup.appendChild(label);
                    formGroup.appendChild(input);
                }
                
                form.appendChild(formGroup);
            });
        } 
        // Fallback to direct parameters object
        else if (selectedTool.parameters) {
            hasParameters = true;
            
            const paramsTitle = document.createElement('h6');
            paramsTitle.textContent = 'Parameters:';
            paramsTitle.className = 'mt-3';
            form.appendChild(paramsTitle);
            
            // Handle different parameter formats
            if (typeof selectedTool.parameters === 'object') {
                if (selectedTool.parameters.properties) {
                    // JSONSchema format
                    parameters = selectedTool.parameters.properties;
                    const requiredParams = selectedTool.parameters.required || [];
                    
                    Object.entries(parameters).forEach(([paramName, paramInfo]) => {
                        const formGroup = document.createElement('div');
                        formGroup.className = 'mb-3';
                        
                        const label = document.createElement('label');
                        label.htmlFor = `param-${paramName}`;
                        label.className = 'form-label';
                        label.textContent = paramName;
                        
                        if (paramInfo.description) {
                            const small = document.createElement('small');
                            small.className = 'd-block text-muted';
                            small.textContent = paramInfo.description;
                            label.appendChild(small);
                        }
                        
                        if (requiredParams.includes(paramName)) {
                            label.innerHTML += ' <span class="text-danger">*</span>';
                        }
                        
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'form-control';
                        input.id = `param-${paramName}`;
                        input.name = paramName;
                        input.dataset.paramName = paramName;
                        
                        if (paramInfo.type === 'object') {
                            input.placeholder = '{"key": "value"}';
                            const helpText = document.createElement('small');
                            helpText.className = 'form-text text-muted';
                            helpText.textContent = 'Enter as JSON object: {"key": "value"}';
                            formGroup.appendChild(label);
                            formGroup.appendChild(input);
                            formGroup.appendChild(helpText);
                        } else if (paramInfo.type === 'array') {
                            input.placeholder = 'value1, value2, value3';
                            const helpText = document.createElement('small');
                            helpText.className = 'form-text text-muted';
                            helpText.textContent = 'Enter multiple values separated by commas, or as a JSON array: ["value1", "value2"]';
                            formGroup.appendChild(label);
                            formGroup.appendChild(input);
                            formGroup.appendChild(helpText);
                        } else {
                            formGroup.appendChild(label);
                            formGroup.appendChild(input);
                        }
                        
                        form.appendChild(formGroup);
                    });
                } else {
                    // Direct parameter object format
                    Object.entries(selectedTool.parameters).forEach(([paramName, paramInfo]) => {
                        const formGroup = document.createElement('div');
                        formGroup.className = 'mb-3';
                        
                        const label = document.createElement('label');
                        label.htmlFor = `param-${paramName}`;
                        label.className = 'form-label';
                        label.textContent = paramName;
                        
                        if (typeof paramInfo === 'object' && paramInfo.description) {
                            const small = document.createElement('small');
                            small.className = 'd-block text-muted';
                            small.textContent = paramInfo.description;
                            label.appendChild(small);
                        }
                        
                        const input = document.createElement('input');
                        input.type = 'text';
                        input.className = 'form-control';
                        input.id = `param-${paramName}`;
                        input.name = paramName;
                        input.dataset.paramName = paramName;
                        
                        if (typeof paramInfo === 'object' && paramInfo.required) {
                            input.required = true;
                            label.innerHTML += ' <span class="text-danger">*</span>';
                        }
                        
                        formGroup.appendChild(label);
                        formGroup.appendChild(input);
                        form.appendChild(formGroup);
                    });
                }
            }
        }
        
        if (!hasParameters) {
            const noParams = document.createElement('p');
            noParams.className = 'text-muted';
            noParams.textContent = 'This tool has no parameters';
            form.appendChild(noParams);
        }
        
        toolParams.appendChild(form);
        executeToolBtn.disabled = false;
    }

    // Function to collect parameter values from the form
    function collectParameterValues() {
        const paramElements = document.querySelectorAll('[data-param-name]');
        const paramValues = {};
        
        paramElements.forEach(element => {
            const paramName = element.dataset.paramName;
            let value = element.value;
            
            // Log the raw value
            console.log(`Before conversion - ${paramName}: ${value} (${typeof value})`);
            
            // Add to parameter values
            paramValues[paramName] = value;
        });
        
        return paramValues;
    }

    // Function to convert parameter values according to schema
    function convertParameterValues(rawValues, toolSchema) {
        const convertedValues = {};
        
        for (const [paramName, rawValue] of Object.entries(rawValues)) {
            // Skip empty values
            if (rawValue === '') {
                continue;
            }
            
            let convertedValue = rawValue;
            let expectedType = 'unknown';
            
            // Try to convert values to appropriate types based on schema
            if (toolSchema && toolSchema.inputSchema && 
                toolSchema.inputSchema.properties && 
                toolSchema.inputSchema.properties[paramName]) {
                
                const paramSchema = toolSchema.inputSchema.properties[paramName];
                expectedType = paramSchema.type || 'unknown';
                
                console.log(`Parameter ${paramName} has expected type: ${expectedType}`);
                
                // Convert to number if type is number or integer
                if ((paramSchema.type === 'number' || paramSchema.type === 'integer') && !isNaN(Number(rawValue))) {
                    convertedValue = Number(rawValue);
                }
                // Convert to boolean if type is boolean
                else if (paramSchema.type === 'boolean') {
                    if (rawValue.toLowerCase() === 'true') {
                        convertedValue = true;
                    } else if (rawValue.toLowerCase() === 'false') {
                        convertedValue = false;
                    }
                }
                // Handle array type
                else if (paramSchema.type === 'array') {
                    // If it's already a string, try to convert it to an array
                    if (typeof rawValue === 'string') {
                        try {
                            // First try to parse as JSON if it looks like JSON
                            if (rawValue.trim().startsWith('[')) {
                                try {
                                    convertedValue = JSON.parse(rawValue);
                                    console.log(`Parsed ${paramName} as JSON array:`, convertedValue);
                                    
                                    // Double check that we actually got an array
                                    if (!Array.isArray(convertedValue)) {
                                        console.warn(`Parsing ${paramName} succeeded but did not produce an array, forcing array conversion`);
                                        convertedValue = [convertedValue];
                                    }
                                } catch (parseError) {
                                    console.error(`JSON parse error for ${paramName}:`, parseError);
                                    // If JSON parsing fails, fall back to other methods
                                    throw parseError; // Re-throw to be caught by outer try/catch
                                }
                            } 
                            // Otherwise split by comma if commas exist
                            else if (rawValue.includes(',')) {
                                convertedValue = rawValue.split(',').map(item => item.trim());
                                console.log(`Split ${paramName} by commas:`, convertedValue);
                            }
                            // Single value becomes a single-item array
                            else if (rawValue.trim() !== '') {
                                convertedValue = [rawValue.trim()];
                                console.log(`Created single-item array for ${paramName}:`, convertedValue);
                            }
                            // Empty string becomes empty array
                            else {
                                convertedValue = [];
                                console.log(`Created empty array for ${paramName}`);
                            }
                        } catch (e) {
                            console.error(`Error converting ${paramName} to array: ${e.message}`);
                            // Fallback to single-item array if parsing fails
                            convertedValue = [rawValue.trim()];
                            console.log(`Fallback: Created single-item array for ${paramName}:`, convertedValue);
                        }
                        
                        // Final check to ensure we have an array
                        if (!Array.isArray(convertedValue)) {
                            console.warn(`Final check: ${paramName} is not an array, forcing conversion`);
                            if (convertedValue === null || convertedValue === undefined) {
                                convertedValue = [];
                            } else {
                                convertedValue = [convertedValue];
                            }
                        }
                    } else if (Array.isArray(rawValue)) {
                        // Already an array, keep as is
                        convertedValue = rawValue;
                    } else {
                        // Not a string or array, convert to array with single item
                        convertedValue = [rawValue];
                    }
                }
                // Handle object type
                else if (paramSchema.type === 'object') {
                    try {
                        // If it's a string, try to parse it as JSON
                        if (typeof rawValue === 'string') {
                            convertedValue = JSON.parse(rawValue);
                            console.log(`Parsed ${paramName} as object:`, convertedValue);
                        }
                    } catch (e) {
                        console.error(`Error parsing ${paramName} as object: ${e.message}`);
                        // Keep as string if parsing fails
                    }
                }
            }
            
            // Log the conversion
            console.log(`After conversion - ${paramName}: ${JSON.stringify(convertedValue)} (${typeof convertedValue}) [Expected: ${expectedType}]`);
            
            // Add the converted value
            convertedValues[paramName] = convertedValue;
        }
        
        return convertedValues;
    }

    // List available tools according to MCP specification
    listToolsBtn.addEventListener('click', async () => {
        if (!sessionId) {
            createResponseElement('Error: Not connected to server', 'error-message');
            return;
        }

        // Clear previous tools
        toolsList.innerHTML = '';
        toolParams.innerHTML = '<p class="text-muted">Select a tool to see its parameters</p>';
        selectedTool = null;
        availableTools = [];
        toolsMap = {};
        executeToolBtn.disabled = true;

        try {
            const serverUrl = serverUrlInput.value.trim();
            const mcpEndpoint = `${serverUrl}/mcp`;
            
            createResponseElement(`Requesting tools list...`, 'info-message');
            
            // Create request for tool listing
            const listToolsRequest = {
                jsonrpc: "2.0",
                id: `req_${currentRequestId++}`,
                method: "tools/list",
                params: {}
            };
            
            // Send request
            const response = await fetch(mcpEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionId
                },
                body: JSON.stringify(listToolsRequest)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            // Check the content type to determine how to handle the response
            const contentType = response.headers.get('Content-Type');
            console.log("DEBUG: Tools list response Content-Type:", contentType);
            
            if (contentType && contentType.includes('text/event-stream')) {
                // Handle event stream response
                createResponseElement("Received event stream response for tools list", 'info-message');
                
                // Create a reader to read the response body
                const reader = response.body.getReader();
                let decoder = new TextDecoder();
                let buffer = '';
                
                // Read the first chunk to get the tools list response
                const { value, done } = await reader.read();
                if (!done) {
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;
                    
                    console.log("DEBUG: SSE chunk for tools list:", buffer);
                    
                    // Extract the data from the SSE format
                    // SSE format is: "event: message\ndata: {...}\n\n"
                    const dataMatch = buffer.match(/data: (.*?)(\n\n|\n$)/s);
                    if (dataMatch && dataMatch[1]) {
                        try {
                            const jsonData = JSON.parse(dataMatch[1]);
                            console.log("DEBUG: Parsed SSE data for tools list:", jsonData);
                            
                            // Process the tools list
                            if (jsonData.result && jsonData.result.tools && Array.isArray(jsonData.result.tools)) {
                                processToolsList(jsonData.result.tools);
                            } else {
                                throw new Error('Invalid tools response format');
                            }
                        } catch (parseError) {
                            console.error("DEBUG: Error parsing SSE data for tools list:", parseError);
                            createResponseElement(`Raw SSE data (not parsed): ${dataMatch[1]}`, 'debug-message');
                            throw parseError;
                        }
                    } else {
                        console.log("DEBUG: Could not extract data from SSE chunk for tools list");
                        createResponseElement(`Raw SSE chunk: ${buffer}`, 'debug-message');
                        throw new Error('Could not extract data from SSE chunk');
                    }
                }
                
                // Continue reading the stream in the background if needed
                // This is optional since we already got the tools list
                // processEventStream(reader, decoder);
                
            } else {
                // Handle JSON response
                console.log("DEBUG: Tools list response is JSON");
                
                // Process the response
                const result = await response.json();
                
                console.log("DEBUG: Tools list JSON:", JSON.stringify(result, null, 2));
                
                // Process the tools list
                if (result.result && result.result.tools) {
                    processToolsList(result.result.tools);
                } else {
                    throw new Error('Invalid tools response format');
                }
            }
        } catch (error) {
            createResponseElement(`Error fetching tools: ${error.message}`, 'error-message');
            toolsList.innerHTML = '<li class="list-group-item text-danger">Error loading tools</li>';
        }
    });
    
    // Execute selected tool according to MCP specification
    executeToolBtn.addEventListener('click', async () => {
        if (!selectedTool) {
            createResponseElement('No tool selected', 'error-message');
            return;
        }
        
        if (!sessionId) {
            createResponseElement('No active session. Please connect first.', 'error-message');
            return;
        }

        // Get parameter values from form
        const rawParamValues = collectParameterValues();
        const convertedParamValues = convertParameterValues(rawParamValues, selectedTool);

        try {
            const serverUrl = serverUrlInput.value.trim();
            const mcpEndpoint = `${serverUrl}/mcp`;
            const requestId = `exec-${Date.now()}`;
            
            // Create request payload according to MCP spec
            const executeRequest = {
                jsonrpc: "2.0",
                id: requestId,
                method: "tools/call",
                params: {
                    name: selectedTool.name,
                    arguments: convertedParamValues
                }
            };
            
            // Add debug output for the request
            console.log('Final request payload:', JSON.stringify(executeRequest, null, 2));
            createResponseElement(`Executing tool: ${selectedTool.name}`, 'info-message');
            
            // Create a formatted display version of the request for the UI
            const displayPayload = JSON.stringify(executeRequest, null, 2);
            createResponseElement(`Request payload: ${displayPayload}`, 'info-message');
            
            // Send request
            const response = await fetch(mcpEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionId
                },
                body: JSON.stringify(executeRequest)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            // Check the content type to determine how to handle the response
            const contentType = response.headers.get('Content-Type');
            console.log("DEBUG: Tool execution response Content-Type:", contentType);
            
            if (contentType && contentType.includes('text/event-stream')) {
                // Handle event stream response
                createResponseElement("Received event stream response for tool execution", 'info-message');
                
                // Create a reader to read the response body
                const reader = response.body.getReader();
                let decoder = new TextDecoder();
                let buffer = '';
                
                // Read the first chunk to get the tool execution response
                const { value, done } = await reader.read();
                if (!done) {
                    const chunk = decoder.decode(value, { stream: true });
                    buffer += chunk;
                    
                    console.log("DEBUG: SSE chunk for tool execution:", buffer);
                    
                    // Extract the data from the SSE format
                    // SSE format is: "event: message\ndata: {...}\n\n"
                    const dataMatch = buffer.match(/data: (.*?)(\n\n|\n$)/s);
                    if (dataMatch && dataMatch[1]) {
                        try {
                            const jsonData = JSON.parse(dataMatch[1]);
                            console.log("DEBUG: Parsed SSE data for tool execution:", jsonData);
                            
                            // Check for errors
                            if (jsonData.error) {
                                throw new Error(`JSON-RPC error: ${jsonData.error.message}`);
                            }
                            
                            createResponseElement(`Tool execution result: ${JSON.stringify(jsonData, null, 2)}`, 'success-message');
                        } catch (parseError) {
                            console.error("DEBUG: Error parsing SSE data for tool execution:", parseError);
                            createResponseElement(`Raw SSE data (not parsed): ${dataMatch[1]}`, 'debug-message');
                            throw parseError;
                        }
                    } else {
                        console.log("DEBUG: Could not extract data from SSE chunk for tool execution");
                        createResponseElement(`Raw SSE chunk: ${buffer}`, 'debug-message');
                        throw new Error('Could not extract data from SSE chunk');
                    }
                }
                
                // Continue reading the stream in the background if needed
                // This is optional since we already got the tool execution result
                // processEventStream(reader, decoder);
                
            } else {
                // Handle JSON response
                console.log("DEBUG: Tool execution response is JSON");
                
                // Process the response
                const result = await response.json();
                
                console.log("DEBUG: Tool execution JSON:", JSON.stringify(result, null, 2));
                
                // Check for errors
                if (result.error) {
                    throw new Error(`JSON-RPC error: ${result.error.message}`);
                }
                
                createResponseElement(`Tool execution result: ${JSON.stringify(result, null, 2)}`, 'success-message');
            }
        } catch (error) {
            createResponseElement(`Error executing tool: ${error.message}`, 'error-message');
        }
    });

    // Clear response area
    clearResponseBtn.addEventListener('click', () => {
        responseArea.innerHTML = '';
    });

    // Helper function to add message to response area
    function addToResponse(message, className = '') {
        const entry = document.createElement('div');
        entry.className = `event-entry ${className}`;
        entry.textContent = message;
        
        responseArea.appendChild(entry);
        
        // Auto-scroll to bottom if enabled
        if (autoScrollSwitch.checked) {
            responseArea.scrollTop = responseArea.scrollHeight;
        }
    }

    // Helper function to add debug info
    function addDebugInfo(message) {
        const debugInfo = document.createElement('pre');
        debugInfo.className = 'debug-message';
        debugInfo.textContent = message;
        responseArea.appendChild(debugInfo);
        if (autoScrollSwitch.checked) {
            responseArea.scrollTop = responseArea.scrollHeight;
        }
        
        // Also log to console for additional debugging
        console.log("[DEBUG]", message);
        
        // Add an alert for critical debugging
        if (message.includes("error") || message.includes("Error")) {
            alert("Debug: " + message);
        }
    }

    // Try to discover available methods
    async function discoverMethods() {
        if (!sessionId) {
            createResponseElement('No active session. Please connect first.', 'error-message');
            return;
        }

        try {
            const serverUrl = serverUrlInput.value.trim();
            const mcpEndpoint = `${serverUrl}/mcp`;
            
            createResponseElement(`Attempting to discover available methods...`, 'info-message');
            
            // Methods to try
            const methodsToTry = [
                "tools/list",
                "tools/discover",
                "get_tools", 
                "list_tools", 
                "listTools", 
                "get_tool_list", 
                "getTools",
                "discover_tools",
                "discoverTools"
            ];
            
            for (const method of methodsToTry) {
                // Create request with current method
                const request = {
                    jsonrpc: "2.0",
                    id: `discover-${Date.now()}-${method}`,
                    method: method,
                    params: {}
                };
                
                createResponseElement(`Trying method: ${method}`, 'info-message');
                
                // Send request
                const response = await fetch(mcpEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        'Mcp-Session-Id': sessionId
                    },
                    body: JSON.stringify(request)
                });
                
                if (!response.ok) {
                    createResponseElement(`HTTP error for method ${method}: ${response.status}`, 'error-message');
                    continue;
                }
                
                // Process the response
                const result = await response.json();
                
                if (result.error) {
                    if (result.error.code === -32601) {
                        createResponseElement(`Method ${method} not found`, 'warning-message');
                    } else {
                        createResponseElement(`Error for method ${method}: ${result.error.message}`, 'error-message');
                    }
                } else {
                    createResponseElement(`Method ${method} succeeded!`, 'success-message');
                    addDebugInfo(JSON.stringify(result, null, 2));
                    return method; // Return the successful method
                }
            }
            
            createResponseElement(`Method discovery completed. Check results above.`, 'info-message');
            
        } catch (error) {
            createResponseElement(`Error during method discovery: ${error.message}`, 'error-message');
        }
        
        return null;
    }

    // Add a button for method discovery
    const discoverMethodsBtn = document.createElement('button');
    discoverMethodsBtn.className = 'btn btn-secondary';
    discoverMethodsBtn.textContent = 'Discover Methods';
    discoverMethodsBtn.addEventListener('click', discoverMethods);
    
    // Add the button after the list tools button
    listToolsBtn.parentNode.insertBefore(discoverMethodsBtn, listToolsBtn.nextSibling);
});

// Helper function to create response elements
function createResponseElement(message, className) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = message;
    
    // Add the element to the response area
    const responseArea = document.getElementById('responseArea');
    if (responseArea) {
        responseArea.appendChild(element);
        
        // Auto-scroll if enabled
        const autoScrollSwitch = document.getElementById('autoScrollSwitch');
        if (autoScrollSwitch && autoScrollSwitch.checked) {
            responseArea.scrollTop = responseArea.scrollHeight;
        }
    }
    
    return element;
}

// Function to process the event stream
async function processEventStream(reader, decoder) {
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                console.log("DEBUG: Event stream ended");
                createResponseElement("Event stream ended", 'info-message');
                break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            console.log("DEBUG: Received event stream chunk:", chunk);
            
            // Extract the data from the SSE format
            // SSE format is: "event: message\ndata: {...}\n\n"
            const dataMatch = chunk.match(/data: (.*?)(\n\n|\n$)/s);
            if (dataMatch && dataMatch[1]) {
                try {
                    const jsonData = JSON.parse(dataMatch[1]);
                    console.log("DEBUG: Parsed SSE data:", jsonData);
                    createResponseElement(`Received event: ${JSON.stringify(jsonData, null, 2)}`, 'info-message');
                    
                    // Check if this is a tool list response
                    if (jsonData.result && jsonData.result.tools && Array.isArray(jsonData.result.tools)) {
                        processToolsList(jsonData.result.tools);
                    }
                } catch (parseError) {
                    console.error("DEBUG: Error parsing SSE data:", parseError);
                    createResponseElement(`Raw SSE data (not parsed): ${dataMatch[1]}`, 'debug-message');
                }
            } else {
                console.log("DEBUG: Could not extract data from SSE chunk");
                createResponseElement(`Raw SSE chunk: ${chunk}`, 'debug-message');
            }
        }
    } catch (error) {
        console.error("DEBUG: Error in processEventStream:", error);
        createResponseElement(`Error processing event stream: ${error.message}`, 'error-message');
    }
}

// Function to open the event stream
function openEventStream(mcpEndpoint) {
    // Create URL with session ID
    const sseUrl = new URL(mcpEndpoint);
    if (sessionId) {
        sseUrl.searchParams.append('session', sessionId);
    }
    
    createResponseElement(`Opening event stream to ${sseUrl.toString()}...`, 'info-message');
    console.log("DEBUG: EventSource URL:", sseUrl.toString());
    
    // Create and configure EventSource with detailed debugging
    const es = new EventSource(sseUrl.toString());
    console.log("DEBUG: EventSource object created:", es);
    addDebugInfo("EventSource object created");
    
    // Add a raw message handler using the message event
    es.addEventListener('message', function(e) {
        console.log("DEBUG: Raw SSE message received:", e);
        
        // Log the raw event details
        const eventDetails = {
            type: e.type,
            data: e.data,
            lastEventId: e.lastEventId,
            origin: e.origin
        };
        
        addDebugInfo(`Raw SSE message: ${JSON.stringify(eventDetails, null, 2)}`);
        createResponseElement(`Raw message received: ${e.data}`, 'info-message');
        
        // Don't try to parse it yet, just log the raw data
    });
    
    // Add error handler
    es.addEventListener('error', function(e) {
        console.error("DEBUG: EventSource error:", e);
        addDebugInfo(`EventSource error: ${JSON.stringify(e, null, 2)}`);
        createResponseElement("EventSource error occurred", 'error-message');
    });
    
    // Add open handler
    es.addEventListener('open', function(e) {
        console.log("DEBUG: EventSource opened:", e);
        addDebugInfo("EventSource connection opened");
        createResponseElement("EventSource connection opened", 'success-message');
    });
    
    // Store the EventSource object
    eventSource = es;
}
