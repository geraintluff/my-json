var async = require('async');
var mysql = require('mysql');
var jsonPointer = require('json-pointer');

/* Workaround for current version of json-pointer */
jsonPointer.remove = jsonPointer.remove || function (obj, path) {
	var parts = this.parse(path);
	var finalProperty = parts.pop();
	var parent = parts.length ? this.get(obj, this.compile(parts)) : obj;
	delete parent[finalProperty];
	return this;
};

var SchemaCondition = require('./schema-condition');

function LoadError(errors, row, object) {
	this.errors = errors;
	this.row = row;
	this.object = object;
}
LoadError.prototype = new Error('Error loading value');

function Config(obj) {
	this.table = obj.table;
	this.columns = obj.columns;
	this.readOnly = obj.readOnly || {};
	this.writeOnly = obj.writeOnly || {};
	
	this.keyColumns = obj.keyColumn || obj.keyColumns || [];
	this.keyColumns = Array.isArray(this.keyColumns) ? this.keyColumns : [this.keyColumns];
	this.sqlKeyColumns = [];
	for (var i = 0; i < this.keyColumns.length; i++) {
		var column = this.keyColumns[i];
		var entry = this.columns[column] || this.readOnly[column];
		if (typeof entry === 'object') {
			this.sqlKeyColumns.push(entry.alias || column);
		} else if (typeof entry === 'string') {
			this.sqlKeyColumns.push(entry);
		} else {
			this.sqlKeyColumns.push(column);
		}
	}
	this.readColumns = Object.keys(this.columns).concat(Object.keys(this.readOnly));
	this.writeColumns = Object.keys(this.columns).concat(Object.keys(this.writeOnly));
	// Load-order: shortest first
	this.readColumns.sort(function (a, b) {
		return a.length - b.length;
	});
	// Write-order: longest first
	this.writeColumns.sort(function (a, b) {
		return b.length - a.length;
	});
	
	for (var key in this.readOnly) {
		this.columns[key] = this.columns[key] || this.readOnly[key];
	}
	for (var key in this.writeOnly) {
		this.columns[key] = this.columns[key] || this.writeOnly[key];
	}
}
Config.prototype = {
	columnForPath: function (dataPath, type) {
		var columnKey = (type || "") + dataPath;
		if (this.columns[columnKey]) {
			if (typeof this.columns[columnKey] === 'object') {
				return this.columns[columnKey].alias || columnKey;
			} else if (typeof this.columns[columnKey] === 'string') {
				return this.columns[columnKey];
			} else {
				return columnKey;
			}
		}
		return null;
	},
	deconstructColumn: function (column, useAliases) {
		if (useAliases !== false) {
			for (var key in this.columns) {
				if (this.columns[key] === column) {
					column = key;
					break;
				} else if (typeof this.columns[key] === 'object' && this.columns[key].alias === column) {
					column = key;
				}
			}
		}
		var type = column.split('/', 1)[0];
		var dataPath = column.substring(type.length);
		return {
			type: type,
			path: dataPath
		}
	}
};

function PendingRequests(addFunction, runFunction) {
	this.requests = {};
	this.addFunction = addFunction || function (type, params, callback) {
		callback(new Error('Cannot run pending request (from reference) outside of a group'));
	};
	this.runFunction = runFunction || function (connection, type, params, callback) {
		callback(new Error('Cannot run pending request (from reference) outside of a group'));
	};
}
PendingRequests.prototype = {
	add: function (type, params, callback) {
		this.requests[type] = this.requests[type] || [];
		this.requests[type].push(this.addFunction(type, params, callback));
	},
	run: function (connection, callback) {
		var thisPending = this;
		async.map(Object.keys(this.requests), function (key, callback) {
			var paramList = thisPending.requests[key];
			delete thisPending.requests[key];
			return thisPending.runFunction(connection, key, paramList, callback);
		}, callback);
	}
};

function createClass(config, constructor, proto) {
	if (!(config instanceof Config)) {
		config = new Config(config);
	}
	if (!proto && typeof constructor === 'object') {
		proto = constructor;
		constructor = undefined;
	}
	// TODO: use tv4 to validate config
	var escapedTable = mysql.escapeId(config.table);
	var initialTableName = "";
	config.table.replace(/([A-Z])/g, function(letter) {return "_"+letter.toLowerCase();}).replace(/[^a-z_0-9]/g, '_').replace(/^_*/, '').replace(/_*$/, '').split('_').forEach(function (entry) {
		initialTableName += entry.charAt(0);
	});

	var NewClass;
	if (constructor) {
		NewClass = function () {
			var _super = {};
			for (var key in proto) {
				_super[key] = proto[key].bind(this);
			}
			var args = [];
			while (args.length < arguments.length) {
				args[args.length] = arguments.length;
			}
			args.unshift(_super);
			return constructor.apply(this, args);
		}
	} else {
		NewClass = function () {};
	}
	NewClass.prototype = proto || {};
	
	function normaliseKeyValues(keyValues) {
		var newKeyValues = [];
		if (keyValues.length !== config.keyColumns.length) {
			throw new Error('Expected ' + config.keyColumns.length + ' key columns, only got ' + keyValues.length);
		}
		for (var i = 0; i < keyValues.length; i++) {
			var value = keyValues[i];
			var key = config.deconstructColumn(config.keyColumns[i]);
			if ((key.type === 'integer' || key.type === 'number') && typeof value !== 'number') {
				value = parseFloat(value, 10);
				if (isNaN(value)) {
					throw new Error('Key value must be number: ' + keyValues[i]);
				}
			} else if (key.type === 'string') {
				value = "" + value;
			}
			newKeyValues[i] = value;
		}
		return newKeyValues;
	}
	function schemaForKeyValues(keyValues) {
		var schema = {};
		for (var i = 0; i < keyValues.length; i++) {
			var value = keyValues[i];
			var key = config.deconstructColumn(config.keyColumns[i]);
			
			var parts = jsonPointer.parse(key.path);
			var targetSchema = schema;
			for (var j = 0; j < parts.length; j++) {
				var part = parts[j];
				targetSchema.type = 'object';
				targetSchema.properties = targetSchema.properties || {};
				targetSchema.properties[part] = {};
				targetSchema = targetSchema.properties[part];
			}
			targetSchema['enum'] = [value];
		}
		return schema;
	}
	function setResultValue(result, value, key, errors) {
		if (value === null || typeof value === 'undefined') {
			return;
		}
		if (key.type === 'boolean') {
			value = !!value;
		} else if (key.type === 'number') {
			value = parseFloat(value);
		} else if (key.type === 'integer') {
			value = parseInt(value, 10);
		} else if (key.type === 'string') {
			value = "" + value;
		} else if (key.type === 'json') {
			try {
				value = JSON.parse(value);
			} catch (e) {
				errors.push(e);
			}
		} else {
			errors.push(new Error('Unknown column type: ' + key.type));
		}
		if (key.path) {
			jsonPointer.set(result, key.path, value);
		} else if (typeof value === 'object' && !Array.isArray(value)) {
			for (var key in value) {
				result[key] = value[key];
			}
		} else {
			errors.push(new Error("Cannot load non-object into root value"));
		}
	}
	function getParameterValue(obj, key) {
		var value = jsonPointer.get(obj, key.path);
		if (key.type === 'boolean') {
			if (typeof value === 'boolean') {
				value = value ? 1 : 0;
			} else {
				value = null;
			}
		} else if (key.type === 'integer') {
			if (typeof value !== 'number' || Math.floor(value) !== value) {
				value = null;
			}
		} else if (key.type === 'number') {
			if (typeof value !== 'number') {
				value = null;
			}
		} else if (key.type === 'string') {
			if (typeof value !== 'string') {
				value = null;
			}
		} else if (key.type === 'json') {
			value = JSON.stringify(value);
		} else {
			throw new Error('Unknown column type: ' + key.type);
		}
		return value;
	}
	
	NewClass.pendingRequests = new PendingRequests();
	
	var staticMethods = {
		paramsFromObject: function (obj) {
			var params = [];
			for (var i = 0; i < config.keyColumns.length; i++) {
				var splitKey = config.deconstructColumn(config.keyColumns[i]);
				params[i] = getParameterValue(obj, splitKey);
			}
			return params;
		},
		sqlFromSchema: function (schema) {
			var condition = SchemaCondition.fromSchema(schema, config);
			var table = initialTableName;
			return 'SELECT ' + table + '.*\n\tFROM ' + escapedTable + ' ' + table + '\n\tWHERE ' + condition.sqlWhere(table, false, '\t').replace(/\n/g, '\n\t');
		},
		openMultiple: function (connection, map, callback) {
			if (Array.isArray(map)) {
				// Create an object equivalent, and convert back to an array afterwards
				var newMap = {};
				for (var i = 0; i < map.length; i++) {
					newMap[i] = map[i];
				}
				return staticMethods.openMultiple.call(this, connection, newMap, function (err, result) {
					var arrayResult = [];
					for (var i = 0; i < map.length; i++) {
						arrayResult[i] = result[i];
					}
					callback(null, arrayResult);
				});
			}
			var thisClass = this;
			var schema = {anyOf: []};
			var resultsKeys = {};
			for (var mapKey in map) {
				var keyValues = Array.isArray(map[mapKey]) ? map[mapKey] : [map[mapKey]];
				var newKeyValues = normaliseKeyValues(keyValues);
				resultsKeys[mapKey] = JSON.stringify(newKeyValues);
				schema.anyOf.push(schemaForKeyValues(newKeyValues));
			}
			staticMethods.search.call(this, connection, schema, function (err, results) {
				if (err) {
					return callback(err);
				}
				var resultsMap = {};
				for (var resultNumber = 0; resultNumber < results.length; resultNumber++) {
					var obj = results[resultNumber];
					var key = thisClass.paramsFromObject(obj);
					var keyJson = JSON.stringify(key); // all scalar values, so this is deterministic
					resultsMap[keyJson] = obj;
				}
				var result = {};
				for (var key in resultsKeys) {
					result[key] = resultsMap[resultsKeys[key]];
				}
				callback(null, result);
			});
		},
		open: function (connection) {
			var callback = arguments[arguments.length - 1];
			var keyValues = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
			return staticMethods.openMultiple.call(this, connection, {single: keyValues}, function (err, results) {
				if (err) {
					return callback(err);
				}
				callback(null, results.single);
			});
		},
		search:  function (connection, schema, callback) {
			var thisClass = this;
			var sql = this.sqlFromSchema(schema);
			connection.query(sql, function (error, results) {
				if (error) {
					return callback(error);
				}
				for (var i = 0; i < results.length; i++) {
					results[i] = thisClass.fromRow(results[i]);
				}
				thisClass.pendingRequests.run(connection, function (err) {
					callback(err, results);
				});
			});
			return this;
		},
		save: function (connection, obj, forceInsert, callback) {
			var thisClass = this;
			if (typeof forceInsert === 'function') {
				callback = forceInsert;
				forceInsert = undefined;
			}
			if (typeof obj === 'undefined') {
				throw new TypeError('Cannot save undefined value');
			}
			var remainderObject = JSON.parse(JSON.stringify(obj)); // Copy, and also ensure it's JSON-friendly
			var updateObj = {};
			var wherePairs = [];
			var missingKeyColumns = [];
			// Longest first
			for (var i = 0; i < config.writeColumns.length; i++) {
				var column = config.writeColumns[i];
				var isKeyColumn = config.keyColumns.indexOf(column) !== -1;
				var key = config.deconstructColumn(column, false);
				var alias = config.columnForPath(key.path, key.type);
				if (!jsonPointer.has(obj, key.path) || typeof (value = jsonPointer.get(obj, key.path)) === 'undefined') {
					if (isKeyColumn && !forceInsert) {
						missingKeyColumns.push(column);
					} else {
						updateObj[alias] = null;
					}
					continue;
				}
				var value = getParameterValue(remainderObject, key);
				jsonPointer.set(remainderObject, key.path, undefined);
				if (isKeyColumn && !forceInsert) {
					var pair = mysql.escapeId(alias) + "=" + mysql.escape(value);
					wherePairs.push(pair);
				} else {
					updateObj[alias] = value;
				}
			}
			if (missingKeyColumns.length === 0 && !forceInsert) {
				var updatePairs = [];
				for (var alias in updateObj) {
					updatePairs.push(mysql.escapeId(alias) + "=" + mysql.escape(updateObj[alias]));
				}
				var sql = 'UPDATE ' + escapedTable + '\n\tSET ' + updatePairs.join(',\n\t') + '\nWHERE ' + wherePairs.join(' AND ');
				connection.query(sql, function (err, result) {
					if (err) {
						return callback(err);
					}
					if (result.affectedRows || forceInsert === false) {
						callback(null, result);
					} else {
						staticMethods.save.call(thisClass, connection, obj, true, callback);
					}
				});
			} else {
				if (missingKeyColumns.length > 1) {
					throw new Error('Cannot have more than one missing key column: ' + missingKeyColumns);
				}
				var keyColumn = null;
				if (missingKeyColumns.length === 1) {
					var keyColumn = config.deconstructColumn(missingKeyColumns[0]);
					if (keyColumn.type !== 'integer' && keyColumn.type !== 'number') {
						throw new Error('Missing key column must be number: ' + missingKeyColumns);
					}
				}
				var insertColumns = [];
				var insertValues = [];
				for (var alias in updateObj) {
					insertColumns.push(mysql.escapeId(alias));
					insertValues.push(mysql.escape(updateObj[alias]));
				}
				var sql = 'INSERT INTO ' + escapedTable + ' (' + insertColumns.join(', ') + ') VALUES (\n\t' + insertValues.join(',\n\t') + ')';
				connection.query(sql, function (err, result) {
					if (err) {
						return callback(err);
					}
					if (keyColumn) {
						jsonPointer.set(obj, keyColumn.path, result.insertId);
					}
					callback(null, result);
				});
			}
			return this;
		},
		remove: function (connection, obj, callback) {
			var updateObj = {};
			var wherePairs = [];
			var missingKeyColumns = [];
			// Longest first
			for (var i = 0; i < config.keyColumns.length; i++) {
				var column = config.keyColumns[i];
				var isKeyColumn = config.keyColumns.indexOf(column) !== -1;
				var key = config.deconstructColumn(column, false);
				var alias = config.columnForPath(key.path, key.type);
				if (!jsonPointer.has(obj, key.path) || typeof (jsonPointer.get(obj, key.path)) === 'undefined') {
					throw new Error('Cannot delete object missing key columns');
				}
				var value = getParameterValue(obj, key);
				var pair = mysql.escapeId(alias) + "=" + mysql.escape(value);
				wherePairs.push(pair);
			}
			var sql = 'DELETE FROM ' + escapedTable + ' WHERE ' + wherePairs.join(' AND ');
			connection.query(sql, function (err, result) {
				if (err) {
					return callback(err);
				}
				for (var i = 0; i < config.keyColumns.length; i++) {
					var keyColumn = config.deconstructColumn(config.keyColumns[i]);
					jsonPointer.remove(obj, keyColumn.path);
				}
				callback(null, result);
			});
			return this;
		},
		fromRow: function (row) {
			var result = new NewClass();
			var errors = [];
			for (var i = 0; i < config.readColumns.length; i++) {
				var key = config.deconstructColumn(config.readColumns[i]);
				if (key.type === 'reference') {
					var spec = config.columns[config.readColumns[i]];
					var params = {};
					for (var refColumn in spec.columns) {
						var refKey = config.deconstructColumn(refColumn, false);
						setResultValue(params, row[spec.columns[refColumn]], refKey, errors);
					}
					jsonPointer.set(result, key.path, params);
					this.pendingRequests.add(spec.type, params, function (refResult) {
						jsonPointer.set(result, key.path, refResult);
					});
					continue;
				}
				var rowKey = config.columnForPath(key.path, key.type);
				if (!Object.prototype.hasOwnProperty.call(row, rowKey)) {
					continue;
				}
				var value = row[rowKey];
				value = setResultValue(result, row[rowKey], key, errors);
			}
			if (errors.length) {
				console.log(row);
				console.log(value);
				throw new Error(errors, row, value);
			}
			return result;
		},
		cacheWithPool: function (mysqlPool) {
			var result = this.cache();
			function wrapFunction(origFunc) {
				return function () {
					var thisClass= this;
					var args = Array.prototype.slice.call(arguments, 0);
					var callback = args[args.length - 1];
					mysqlPool.getConnection(function (err, connection) {
						if (err) {
							return callback(err);
						}
						args.unshift(connection);
						// Override callback to release connection first
						args[args.length - 1] = function () {
							connection.release();
							return callback.apply(this, arguments);
						};
						origFunc.apply(thisClass, args);
					});
					return this;
				};
			}
			result.search = wrapFunction(result.search);
			result.save = wrapFunction(result.save);
			result.remove = wrapFunction(result.remove);
			result.open = wrapFunction(result.open);
			result.openMultiple = wrapFunction(result.openMultiple);
			result.forceQuery = wrapFunction(result.forceQuery);
			return result;
		},
		cacheWith: function (mysqlConnection) {
			var result = this.cache();
			result.search = result.search.bind(result, mysqlConnection);
			result.save = result.save.bind(result, mysqlConnection);
			result.remove = result.remove.bind(result, mysqlConnection);
			result.open = result.open.bind(result, mysqlConnection);
			result.openMultiple = result.openMultiple.bind(result, mysqlConnection);
			result.forceQuery = result.forceQuery.bind(result, mysqlConnection);
			return result;
		},
		cache: function () {
			var objectCache = {};
			
			var laterOpenParams = {};
			var openCallbacks = {};
			var cacheMethods = {
				forceQuery: function (connection, callback) {
					return cacheMethods.openMultiple.call(this, connection, laterOpenParams, callback);
				},
				openLater: function () {
					var args = Array.prototype.slice.call(arguments, 0);
					var callback = null;
					if (typeof args[args.length - 1] === 'function') {
						callback = args.pop()
					}
					var keyValues = normaliseKeyValues(args);
					var keyJson = JSON.stringify(keyValues);
					if (keyJson in objectCache) {
						if (callback) {
							process.nextTick(callback.bind(null, objectCache[keyJson]));
						}
						return;
					}
					laterOpenParams[keyJson] = keyValues;
					if (callback) {
						openCallbacks[keyJson] = openCallbacks[keyJson] || [];
						openCallbacks[keyJson].push(callback);
					}
					return this;
				},
				openMultiple: function (connection, map, callback) {
					if (Array.isArray(map)) {
						// Create an object equivalent, and convert back to an array afterwards
						var newMap = {};
						for (var i = 0; i < map.length; i++) {
							newMap[i] = map[i];
						}
						return cacheMethods.openMultiple.call(this, connection, newMap, function (err, result) {
							var arrayResult = [];
							for (var i = 0; i < map.length; i++) {
								arrayResult[i] = result[i];
							}
							callback(null, arrayResult);
						});
					}
					var newMap = {};
					var resultsKeys = {};
					var cachedResults = {};
					for (var mapKey in map) {
						var keyValues = Array.isArray(map[mapKey]) ? map[mapKey] : [map[mapKey]];
						var newKeyValues = normaliseKeyValues(keyValues);
						var keyJson = JSON.stringify(newKeyValues);
						if (keyJson in objectCache) {
							cachedResults[mapKey] = objectCache[keyJson];
						} else {
							resultsKeys[mapKey] = keyJson;
							newMap[keyJson] = map[mapKey];
						}
					}
					if (Object.keys(newMap).length === 0) {
						process.nextTick(callback.bind(null, null, cachedResults));
						return this;
					}
					for (var key in laterOpenParams) {
						newMap[key] = laterOpenParams[key];
					}
					laterOpenParams = {};
				
					return NewClass.openMultiple.call(this, connection, newMap, function (err, results) {
						if (err) {
							return callback(err);
						}
						var newResults = {};
						for (var key in cachedResults) {
							newResults[key] = cachedResults[key];
						}
						for (var mapKey in resultsKeys) {
							newResults[mapKey] = results[resultsKeys[mapKey]];
						}
						callback(null, newResults);
					});
				},
				open: function (connection) {
					var callback = arguments[arguments.length - 1];
					var keyValues = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
					return cacheMethods.openMultiple.call(this, connection, {single: keyValues}, function (err, results) {
						if (err) {
							return callback(err);
						}
						callback(null, results.single);
					});
				},
				fromRow: function (row) {
					var key = [];
					for (var i = 0; i < config.sqlKeyColumns.length; i++) {
						key[i] = row[config.sqlKeyColumns[i]];
					}
					var keyJson = JSON.stringify(key); // all scalar values, so this is deterministic
					if (keyJson === '[]') {
						// Nothing to cache, or all key columns undefined
						return NewClass.fromRow.call(this, row);
					}
					if (keyJson in objectCache) {
						return objectCache[keyJson];
					} else {
						delete laterOpenParams[keyJson];
						var result = NewClass.fromRow.call(this, row);
						objectCache[keyJson] = result;
						if (openCallbacks[keyJson]) {
							while (openCallbacks[keyJson].length > 0) {
								var callback = openCallbacks[keyJson].shift();
								callback(result);
							}
							delete openCallbacks[keyJson];
						}
						return result;
					}
				}
			};

			function Cache() {
				return NewClass.apply(this, arguments);
			}
			Cache.pendingRequests = NewClass.pendingRequests;
			Cache.prototype = Object.create(NewClass.prototype);
			for (var key in staticMethods) {
				Cache[key] = staticMethods[key];
			}
			for (var key in cacheMethods) {
				Cache[key] = cacheMethods[key];
			}
			
			return Cache;
		}
	}
	
	for (var key in staticMethods) {
		NewClass[key] = staticMethods[key];
	}
	
	return NewClass;
}

var publicApi = createClass;
publicApi.sqlMatchPattern = function (sql, pattern) {
	if (Array.isArray(pattern)) {
		for (var i = 0; i < pattern.length; i++) {
			if (publicApi.sqlMatchPattern(sql, pattern[i])) {	
				return true;
			}
		}
		return false;
	}

	// Normalise both SQL and pattern - convert all whitespace to single-spaces, strip space around brackets
	sql = sql.replace(/[ \t\r\n]+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ ?\) ?/g, ')');
	pattern = pattern.replace(/[ \t\r\n]+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ ?\) ?/g, ')');
	
	var patternSubs = {};
	while (sql.length > 0 || pattern.length > 0) {
		if (sql.charAt(0) === pattern.charAt(0)) {
			sql = sql.substring(1);
			pattern = pattern.substring(1);
		} else if (pattern.charAt(0) === '{') {
			var templateVar = pattern.match(/^[^}]*}/)[0];
			var sqlValue = sql.match(/^[a-zA-Z0-9_]*/)[0];
			if (!sqlValue) {
				return false;
			}
			pattern = pattern.substring(templateVar.length);
			sql = sql.substring(sqlValue.length);
			templateVar = templateVar.substring(1, templateVar.length - 1);

			if (typeof patternSubs[templateVar] === 'undefined') {
				patternSubs[templateVar] = sqlValue;
			} else if (patternSubs[templateVar] !== sqlValue) {
				return false;
			}
		} else {
			return false;
		}
	}
	return true;
};

// TODO: errors

// Not a general-purpose fake - just enough to cover everything MyJSON uses
function FakeConnection (queryMethod) {
	if (!(this instanceof FakeConnection)) {
		return new FakeConnection(queryMethod);
	}
	this.query = function (sql, inserts, callback) {
		if (typeof inserts === 'function') {
			return queryMethod.call(this, sql, function (err, results) {
				inserts(err, results || {affectedRows: 1});
			});
		}
		sql = mysql.format(sql, inserts);
		return queryMethod.call(this, sql, function (err, results) {
			callback(err, results || {affectedRows: 1});
		});
	}
};
publicApi.FakeConnection = FakeConnection;

// Not a general-purpose pool - just enough to cover everything MyJSON uses
function FakePool (queryMethod, maxConnections) {
	if (!(this instanceof FakePool)) {
		return new FakePool(queryMethod, maxConnections);
	}
	maxConnections = maxConnections || 1;
	var connectionCount = 0;
	this.getConnection = function (callback) {
		process.nextTick(function () {
			connectionCount++;
			if (connectionCount > maxConnections) {
				throw new Error('Exceeded maximum connection limit: ' + maxConnections);
			}
			var connection = new FakeConnection(queryMethod);
			connection.release = function () {
				connectionCount--;
			};
			callback(null, connection);
		});
	}
};
publicApi.FakePool = FakePool;

function ClassGroup(configs) {
	if (!(this instanceof ClassGroup)) {
		return new ClassGroup(configs);
	}
	var thisGroup = this;
	this.classes = {};
	var pendingRequests = new PendingRequests(function (key, params, callback) {
		var keyClass = thisGroup[key];
		return {
			params: keyClass.paramsFromObject(params),
			callback: callback
		};
	}, function (connection, key, params, callback) {
		var keyClass = thisGroup[key];
		var paramList = [];
		var callbackList = [];
		for (var i = 0; i < params.length; i++) {
			paramList.push(params[i].params);
			callbackList.push(params[i].callback);
		}
		keyClass.openMultiple(connection, paramList, function (err, resultList) {
			if (err) {
				return callback(err);
			}
			for (var i = 0; i < callbackList.length; i++) {
				var resultCallback = callbackList[i];
				resultCallback(resultList[i]);
			}
			callback(null);
		});
	});
	this.addClass = function (key, config) {
		this[key] = this.classes[key] = createClass(config);
		this[key].pendingRequests = pendingRequests;
	};
	for (var key in configs) {
		this.addClass(key, configs[key]);
	}
}
ClassGroup.prototype = {
	cacheWithPool: function (mysqlPool) {
		var cached = {};
		for (var key in this.classes) {
			cached[key] = this[key].cacheWithPool(mysqlPool);
		}
		return cached;
	},
	cacheWith: function (connection) {
		var cached = {};
		for (var key in this.classes) {
			cached[key] = this[key].cacheWith(connection);
		}
		return cached;
	}
};

publicApi.group = ClassGroup;

module.exports = publicApi;