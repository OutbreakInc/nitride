var childProcess = require("child_process");
var Path = require("path");

//objective:
//  turn the following high-level actions into sequences of gdb commands:
//    build, flash, restart-run, restart-paused, set-breakpoints, run, pause, set-expression
//  notify on the following events:
//    halted, async-error


function parseGDB_MI(response)
{
	var o = {};
	_parse_inner(response.match(/("([^"\\]|\\.)*")|,|([\w-]+)|=|\{|\}|\[|\]/g), o);
	return(o);
}

function _parse_inner(tokens, o)
{
	while(tokens.length > 0)
	{
		var t = tokens.shift(), k, v;
		switch(t)
		{
		case ",":
		case "}":
		case "]":
			if(v !== undefined)
				if(o instanceof Array)	o.push(v);
				else					o[k] = v;
			k = v = undefined;
			
			if(t == ",")	break;
			else			return;
		case "=":
			k = v;
			break;
		case "{":
			arguments.callee(tokens, v = {});
			break;
		case "[":
			arguments.callee(tokens, v = []);
			break;
		default:
			if((typeof t == "string") && (t[0] == '"'))
				v = t.substr(1, t.length - 2).replace(/\\(["'])/g, "$1").replace(/\\\\/g, "\\");
			else v = t;
			if(!isNaN(v))	v = Number(v);
			break;
		}
	}
	if(o instanceof Array)	o.push(v);
	else					o[k] = v;
}

Command.prototype =
{
	command: undefined,
	callback: undefined,
	response: "",
	error: false,
	active: true,
	expectsResponse: true
};
function Command(cmd, expectsResponse, callback)
{
	this.command = cmd || "";
	this.active = true;
	this.expectsResponse = expectsResponse;
	this.callback = callback || function()
	{
		console.log("(no callback associated with command \"" + cmd + "\".)");
	};
}

CodeTalker.prototype =
{
	listen: function CodeTalker_listen(eventName, fn, context)
	{
		(this._listeners[eventName] || (this._listeners[eventName] = [])).push(
		{
			fn: fn,
			context: context
		});
	},
	ignore: function CodeTalker_ignore(eventName, fn, context)
	{
		var l = this._listeners[eventName];
		if(l)
		{
			for(var i in l)
			{
				if((l[i].fn == fn) && (l[i].context == context))
					l.splice(i, 1);
			}
			if(l.length == 0)
				delete this._listeners[eventName];
		}
	},
	_emit: function CodeTalker__emit(eventName)
	{
		var l = this._listeners[eventName];
		var args = Array.prototype.slice.call(arguments, 1);
		if(l)
			for(var i in l)
				l[i].fn.apply(l[i], args);
	},
	
	getStack: function CodeTalker_getStack()
	{
		return(this._lastCallstack);
	},
	
	getVars: function CodeTalker_getVars()
	{
		return(this._lastVars);
	},

	connect: function CodeTalker_connect(port, callback)
	{
		var c = function()
		{
			//can't simply queue this because disconnecting flushes the queue
			this.submit("-target-select remote localhost:" + port, function(taskContext)
			{
				if(taskContext.response == "connected")
				{
					this._connectedPort = port;
					callback();
				}
				else
				{
					console.log("connecting to the hardware failed!");
					callback(new Error("Could not connect to the specified device"));
				}
			}.bind(this));
		};

		//disconnect first if necessary
		if(this._connectedPort != undefined)
			this.disconnect(function()
			{
				c.call(this);
			}.bind(this));
		else
			c.call(this);
	},
	disconnect: function CodeTalker_disconnect(callback)
	{
		this.submit("-target-disconnect", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				this.init();
				callback();
			}
			else
			{
				console.log("connecting to the hardware failed!");
				callback(new Error("Could not connect to the specified device"));
			}
		}.bind(this));
	},
	
	flash: function CodeTalker_flash(callback)
	{
		this.submit("-target-download", function(taskContext)
		{
			if(taskContext.response == "done")
				callback();
			else
				callback(new Error("Firmware flash failed."));
		}.bind(this));
	},
	
	restart: function CodeTalker_restart(callback)
	{
		this.dereferenceVar("$pc", function(error, args)
		{
			if(error == undefined)
				this.submit("-var-assign $pc 0", function(taskContext)
				{
					if(taskContext.response == "done")
						callback();
					else
						callback(new Error("Restart failed."));
				}.bind(this));
			else
				callback(new Error("Restart failed."));
		}.bind(this));
	},
	
	setBreakpoint: function CodeTalker_setBreakpoint(file, line, callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't set breakpoints in the '" + this._runState + "' state.")));
		
		this.submit("-break-insert -h " + file + ":" + line, function(taskContext)
		{
			if(taskContext.response == "done")
			{
				var breakpoint = taskContext.args.bkpt;

				//insert the breakpoint into our breakpoint cache
				this._breakpoints[breakpoint.number] = breakpoint;

				callback(undefined, breakpoint.number);
			}
			else
				callback(new Error("could not set the breakpoint."));
		}.bind(this));
	},
	removeBreakpoint: function CodeTalker_removeBreakpoint(breakpointNum, callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't remove breakpoints in the '" + this._runState + "' state.")));
		
		if(this._breakpoints[breakpointNum] == undefined)
			return(callback(new Error("can't remove an unknown breakpoint")));

		this.submit("-break-delete " + breakpointNum, function(taskContext)
		{
			if(taskContext.response == "done")
			{
				//remove the breakpoint from our breakpoint cache
				delete this._breakpoints[breakpointNum];

				callback(undefined, breakpointNum);
			}
			else
				callback(new Error("could not set the breakpoint."));			
		}.bind(this));
	},
	
	run: function CodeTalker_run(callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't run in the '" + this._runState + "' state.")));

		this._clearVars();

		this.submit("-exec-continue", function(taskContext)
		{
			if(taskContext.response == "running")
			{
				//schedule callback for as soon as the *status changes
				this._statusCallback = function CodeTalker_run_onCompletion()
				{
					this._statusCallback = null;
					callback();
				}.bind(this);
			}
			else
				callback(new Error("Could not continue."));
		}.bind(this));
	},
	
	pause: function CodeTalker_pause(callback)
	{
		if(this._runState != "running")
			return(callback(new Error("can't pause in the '" + this._runState + "' state.")));

		this.submit("-exec-interrupt", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				//schedule callback for as soon as the *status changes
				this._statusCallback = function CodeTalker_pause_onCompletion()
				{
					this._statusCallback = null;
					callback(undefined, taskContext.args);
				}.bind(this);
			}
			else
				callback(new Error("Could not interrupt execution."));
		}.bind(this));
	},
	
	updateCallstack: function CodeTalker_updateCallstack(callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't update the callstack in the '" + this._runState + "' state.")));

		this.submit("-stack-list-frames", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				this._lastCallstack = taskContext.args.stack;
				this.submit("-stack-list-arguments --simple-values", function(taskContext)
				{
					if(taskContext.response == "done")
					{
						//merge args
						for(var i = 0; i < this._lastCallstack.length; i++)
							this._lastCallstack[i].args = taskContext.args["stack-args"][i].args;	//arg!

						this._lastCallstack = this._normalizeStack(this._lastCallstack);
						callback(undefined, this._lastCallstack);
					}
					else
						callback(new Error("Could not fetch arguments for callstack."));
				}.bind(this));
			}
			else
				callback(new Error("Could not fetch callstack."));
		}.bind(this));
	},

	updateVars: function CodeTalker_updateVars(callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't update variables in the '" + this._runState + "' state.")));
		
		this._clearVars();

		this.submit("-stack-list-variables --simple-values", function(taskContext)
		{
			if(taskContext.response == "done")
			{
				this._activeVars = {};
				this._lastVars = this._normalizeVars(taskContext.args.variables);
				callback(undefined, this._lastVars);
			}
			else
				callback(new Error("Could not fetch local variables."));
		}.bind(this));
	},

	getVarFrame: function CodeTalker_getVarFrame()
	{
		return(this._lastFrameNum);
	},
	setVarFrame: function CodeTalker_setVarFrame(frameNum, callback)
	{
		if((this._runState != "stopped") || (this._lastCallstack == null))
			return(callback(new Error("can't view variables in the '" + this._runState + "' state.")));

		//test frameNum against the known frame
		if(isNaN(frameNum) || (frameNum < 0) || (frameNum >= this._lastCallstack.length))
			return(callback(new Error("Not a valid frame.")));

		if(frameNum == this._lastFrameNum)
			return(callback(undefined));	//same frame, nothing to do

		this._clearVars();

		this.submit("-stack-select-frame " + frameNum, function(taskContext)
		{
			if(taskContext.response == "done")
			{
				this._lastFrameNum = frameNum;
				callback(undefined);
			}
			else
			{
				callback(new Error("setting the callstack failed."));
			}
		}.bind(this));
	},
	dereferenceVar: function CodeTalker_dereferenceVar(variable, callback)
	{
		if(this._runState != "stopped")
			return(callback(new Error("can't dereference variables in the '" + this._runState + "' state.")));

		var baseVar = variable.split(".")[0];

		if(this._activeVars[baseVar])	//do we have a reference already?
			return(this._deref(baseVar, variable, callback));
		
		//otherwise, find the var in the var cache, and see if we can dereference it.
		//  If so, make it an active var for this frame and this session
		var v = this._lastVars[baseVar];
		if(v)
		{
			//attempt to reliably determine if a variable can be dereferenced
			if((v.type.indexOf("*") > 0) || (v.value == undefined))
			{
				this.submit("-var-create " + baseVar + " * " + baseVar, function(taskContext)
				{
					if(taskContext.response == "done")
					{
						//insert the var into the active cache and complete with this._deref()
						this._activeVars[baseVar] = true;
						this._cacheVar(variable, this._normalizeVars([taskContext.args]));
						this._deref(baseVar, variable, callback);
					}
					else
						callback(new Error("Tried to dereference that variable and failed."));
				}.bind(this));
			}
			else
				return(callback(new Error("Cannot dereference that variable.")));
		}
		else
			return(callback(new Error("Could not find that variable.")));
	},
	_normalizeVars: function CodeTalker__normalizeVars(children)
	{
		var v = {};

		for(var i = 0; i < children.length; i++)
		{
			var n = children[i], o = {};

			//for now, ignore @entry vars
			if(n.name.indexOf("@") > 0)
				continue;

			if(n.exp)
			{
				o.id = n.name;
				o.name = n.exp;
			}
			else
				o.name = n.name;
			o.value = n.value;
			o.type = n.type;
			
			if((n.value != "<optimized out>") && ((n.numchild > 0) || (n.type.indexOf("*") > 0)))
				o.children = true;

			v[o.name] = o;
		}

		return(v);
	},
	_normalizeStack: function CodeTalker__normalizeStack(stack)
	{
		var newStack = [];
		for(var i = 0; i < stack.length; i++)
		{
			var s = stack[i];
			newStack.push(
			{
				file: Path.basename(s.fullname),
				line: s.line,
				path: s.fullname,
				name: s.func.split("::").pop(),	//take the leaf name for C++ methods
				func: s.func,
				level: s.level,
				addr: s.addr,
				args: ((s.args instanceof Array)? this._normalizeVars(s.args) : [])
			});
		}
		return(newStack);
	},
	_cacheVar: function(id, variableObject)
	{
		var o = this._lastVars, path = id.split(".");

		if(path.length > 1)
		{
			if(o[path[0]] == undefined)
				return(false);

			o = o[path.shift()];
			while(path.length > 1)
			{
				if((typeof o.children == "object") && (o.children[path[0]]))
				{
					o = o.children[path.shift()];	//dive deeper
					continue;
				}
				else
					return(false);
			}
			if(o.children === true)
				o = o.children = {};
		}

		o[path[0]] = variableObject;
		return(true);
	},
	_deref: function CodeTalker__deref(baseVar, variable, callback)
	{
		//private

		this.submit("-var-list-children --simple-values " + variable, function(taskContext)
		{
			if(taskContext.response == "done")
			{
				var v;
				if(taskContext.args.children)
					this._cacheVar(variable, v = this._normalizeVars(taskContext.args.children));
				callback(undefined, v);
			}
			else
			{
				callback(new Error("Dereferencing the variable failed."));
			}
		}.bind(this));
	},
	_clearVars: function CodeTalker__clearVars()
	{
		//remove gdb variables for the last vars
		for(var v in this._activeVars)
			this.submit("-var-delete " + v, function(){});	//ignore completion

		//trash the last vars
		this._activeVars = null;
		this._lastVars = null;
	},
	evalExpression: function CodeTalker_evalExpression()
	{
		;
	},
	
	setExpression: function CodeTalker_setExpression()
	{
	},
	
	submit: function CodeTalker_submit(command, expectsResponse, callback)
	{
		if(arguments.length == 2)
		{
			callback = expectsResponse;
			expectsResponse = true;
		}
		
		this._tasks.push(new Command(command, expectsResponse, callback));
		if(!this._tasksActive)
			this.nextTask();
		//else
		//	console.log("not spurring queue.");
	},
	nextTask: function CodeTalker_nextTask()
	{
		if(this._tasks.length == 0)
		{
			this._tasksActive = false;
			return;
		}
		
		//act on the task
		this._tasksActive = true;
		
		if(this._tasks[0].command == undefined)
			throw new Error("why??");
		
		console.log("submitting command: >>" + this._tasks[0].command + "<<");
		this._process.stdin.write(this._tasks[0].command + "\n");
	},
	cycleTask: function CodeTalker_cycleTask()
	{
		if(this._tasks.length > 0)
		{
			if(		this._tasks[0].active
					|| (this._tasks[0].expectsResponse && (this._tasks[0].response == undefined))
				)
				return;	//not finished yet

			var task = this._tasks.shift();
			
			if(this._tasks.length == 0)
				_tasksActive = false;
			
			//tasks added between here
			var outerTasks = this._tasks;
			this._tasks = [];
			
			task.callback(task);
			
			this._tasks = this._tasks.concat(outerTasks);
			//..and here get prioritized before any others
			
			this.nextTask();
		}
	},
	
	spawn: function CodeTalker_spawn()
	{
		this.quit();	//terminate existing process

		var subProcess = childProcess.spawn(this._processPath, this._processArgs,
			{
				env:
				{
				}
			});

		subProcess.stdout.setEncoding("utf8");
		subProcess.stderr.setEncoding("utf8");

		subProcess.stdout.on("data", function(d)
		{
			console.log("stdout: >>", d, "<<");
			
			var response = d.trim().split("\n");

			for(var i = 0; i < response.length; i++)	//for each line
			{
				var r = response[i].trim();
				
				var token = r.match(/^\d+/);
				if(token != null)	token = token[0];

				//parse gdb output
				if(r == "(gdb)")
				{
					if(this._tasks.length > 0)
						this._tasks[0].active = false;
					else
						console.log("ERROR >>>> prompt received for a task that has completed already!");

					this.cycleTask();
				}
				else
				{
					var command, args, commaSplit = r.indexOf(",");
					if(commaSplit >= 0)
					{
						command = r.substr(0, commaSplit);
						args = parseGDB_MI(r.substr(commaSplit + 1));
					}
					else
						command = r;

					var sym = command.substr(0, 1)
					if(sym == "^")
					{
						//complete a command with this response
						if(this._tasks.length > 0)
						{
							this._tasks[0].response = command.substr(1);
							this._tasks[0].args = args;
						}
						else
							console.log("ERROR >>>> response received for a task that has completed already!");

						this.cycleTask();
					}
					else if(sym == "~")
					{
						console.log("GDB: ", command);
					}
					else if(sym == "&")
					{
						console.log("GDB: ", command);
					}
					else switch(command)
					{
					case "*stopped":
						console.log("update run state with: ", command, " and args: ", args);
						this._runState = "stopped";
						this._stopReason = args;
						this._lastFrameNum = 0;
						if(this._statusCallback)
							this._statusCallback();
						this._emit("runstate", {state: this._runState, reason: this._stopReason});
						break;
					case "*running":
						console.log("update run state with: ", command, " and args: ", args);
						this._runState = "running";
						if(this._statusCallback)
							this._statusCallback();
						this._emit("runstate", {state: this._runState});
						break;
					case "=breakpoint-modified":
						console.log("update breakpoint table with: ", args);
						break;
					}
				}
			}
		}.bind(this));
		
		subProcess.stderr.on("data", function(d)
		{
			console.log("stderr: ", d);
			
			if(this._tasks.length > 0)
			{
				//this._tasks[0].response += d;
				this._tasks[0].error = true;
			}
		}.bind(this));
		
		subProcess.on("exit", function(code)
		{
			console.log("subProcess exited with: ", code);

			if(this._restartWhenDied)
			{
				console.log("Respawning sub-process in a moment...");
				setTimeout(function(){this.spawn()}.bind(this), 500);
			}
		}.bind(this));
		
		this._process = subProcess;
		
		//prime the task queue
		var initialCommand = new Command("", false, function()
		{
			console.log("gdb started.");
		});
		this._tasks.push(initialCommand);
		this._tasksActive = true;

		//first real task
		this.submit("-gdb-set target-async 1", function()
		{
			console.log("gdb ready.");
		});
	},
	
	//resets state when the connection to the gdb server is terminated, either intentionally or unexpectedly
	init: function CodeTalker_init()
	{
		this._tasks = [];	//serves to arrest any ongoing tasks too

		this._connectedPort = undefined;
		this._runState = undefined;
		this._statusCallback = undefined;
		this._stopReason = undefined;

		this._lastCallstack = null;
		this._lastVars = null;
		this._lastFrameNum = 0;
		this._breakpoints = {};
	},

	quit: function CodeTalker_quit()
	{
		if(this._process != null)
		{
			this.init();
			this._restartWhenDied = false;
			this._process.kill();
			this._process = null;
		}
	},
	
	_process: null,
	_restartWhenDied: null,
	_tasks: null,
	_listeners: null,

	//state:
	_connectedPort:		undefined,
	_runState:			undefined,
	_statusCallback:	undefined,
	_stopReason:		undefined,

	_lastCallstack: null,
	_lastVars: null,
	_lastFrameNum: 0,
	_breakpoints: null
}
function CodeTalker(processPath, processArgs)
{
	this._processPath = processPath;
	this._processArgs = processArgs;

	this._process = null;
	this._restartWhenDied = true;
	this._listeners = {};
	this.init();
	this.spawn();
}

if(require.main == module)
{
	var gdb = new CodeTalker("/Users/kuy/Projects/Galago/galago-ide/SDK/bin/arm-elf-gdb", ["--interpreter=mi2", "/Users/kuy/Projects/Galago/ide/ardbeg/testProject/module.elf"]);

	function genericCompletion(taskContext)
	{
		console.log("task \"" + taskContext.command + "\" completed with: ", taskContext.response, " and args: ", taskContext.args);
	}

	//testing:
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", function(d)
	{
		d = String(d).trim();
		var method = d.split(" ");
		if(CodeTalker.prototype[method[0]])
		{
			method.push(function()
			{
				console.log("completed with arguments: ", arguments, " >>> ", JSON.stringify(arguments[1]));
			});
			CodeTalker.prototype[method.shift()].apply(gdb, method);
		}
		else
			gdb.submit(d, genericCompletion);
	});
	process.stdin.resume();
}

module.exports =
{
	CodeTalker: CodeTalker
};
