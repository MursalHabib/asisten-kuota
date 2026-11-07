const express = require('express');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
// app.use(helmet());
// app.use(rateLimiter);

app.use('/api', require('./routes'));
app.get('/', (req, res) =>
	res.json({ message: 'Welcome to Asisten Kuota: Agent AI' }),
);

// app.use(errorHandler);

app.listen(PORT, async () => {
	console.log('SERVER UP: http://127.0.0.1:', +PORT);
});
