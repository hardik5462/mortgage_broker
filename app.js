// Import Packages- Packages-Load all required libraries.
const express = require('express');
const mysql = require('mysql');
const session = require('express-session');
const bcrypt = require('bcrypt');
const app = express();

// Middleware- Parse JSON & Form Data-Read data sent from forms and APIs.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Setup - Store login information after user logs in.
app.use(session({
    secret: 'shinyfinance',
    resave: false,
    saveUninitialized: true
}));

//Global Variables for EJS--Make username and role available on every EJS page automatically
app.use((req, res, next) => {
    res.locals.username = req.session?.username;
   res.locals.role = req.session?.role ? req.session.role.toLowerCase() : null; 
    next();
});

//View Engine & Static Files -EJS renders pages- CSS, JS, images come from /public
app.set('view engine', 'ejs');
app.use('/public',
    express.static(__dirname + '/public')
);

//Database Connection - Connect application to MySQL.
const conn = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'loandb'
});

conn.connect((err) => {
    if (err) throw err;
    console.log('MySQL Connected');
});

//Security Middleware

//Login Protection -Only logged-in users can access protected pages.
function requireLogin(req, res, next) {

    if (!req.session.userId) {
        return res.redirect('/login');
    }

    next();
}

//Admin Protection -Only admins can access admin pages.
function requireAdmin(req, res, next) {

    if (req.session.role !== 'admin') {
        return res.status(403).send('Access Denied');
    }

    next();
}

//Reusable Page Renderer-Avoid duplicate route code.
function renderPage(page) {
    return (req, res) => {
        res.render('layout', {
            view: page
        });
    };
}

//Public GET Routes-Public pages anyone can visit.
app.get('/', renderPage('pages/home'));
app.get('/fhb', renderPage('pages/first_hb'));
app.get('/login', renderPage('pages/login'));
app.get('/register', renderPage('pages/register'));
app.get('/enquiry', renderPage('pages/enquiry'));

//Interest Rates Route-Display interest rates from database.   
app.get('/ir', (req, res) => {

    const sql =
        'SELECT id, term, rate, lender FROM interest_rate';

    conn.query(sql, (err, results) => {

        if (err) {
            console.error(err);
            return res.status(500).send('Database Error');
        }

        res.render('layout', {
            view: 'pages/interest_rate',
            rates: results
        });

    });

});

//Dashboard Route-Only logged-in users can access dashboard.
app.get('/dashboard',
    requireLogin,
    (req, res) => {

        res.render('layout', {
            view: 'pages/dashboard'
        });

    });

//Registration Route-Register and encrypt password.
// Registration Route
app.post('/registerUser', async (req, res) => {

    const { name, email, password } = req.body;

    try {

        const hashedPassword = await bcrypt.hash(password, 10);

        const sql =
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';

        conn.query(
            sql,
            [name, email, hashedPassword],
            (err, result) => {

                if (err) {

                    if (err.code === 'ER_DUP_ENTRY') {
                        return res.send('Email already exists!');
                    }

                    return res.status(500).send('Database Error');
                }

                res.render('layout', {
                    view: 'pages/register_success'
                });

            }
        );

    } catch (err) {

        console.error(err);
        res.status(500).send('Server Error');

    }

});

//Login Route -Verify password and create session.
app.post('/auth', async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.send(
            'Please enter email and password'
        );
    }

    conn.query(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, results) => {

            if (err)
                return res.status(500)
                    .send('Database Error');

            if (results.length === 0)
                return res.send(
                    'Incorrect email or password'
                );

            const user = results[0];

            const match =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!match)
                return res.send(
                    'Incorrect email or password'
                );

            req.session.userId = user.id;
            req.session.username = user.name;
            req.session.role = user.role;

            res.redirect('/dashboard');

        }
    );

});

//Logout Route -Remove session and log out.
app.get('/logout', (req, res) => {

    req.session.destroy();

    res.redirect('/');

});

// Enquiry Route
app.post('/submitEnquiry', (req, res) => {

    const {
        name,
        email,
        phone,
        message
    } = req.body;

    const sql =
        'INSERT INTO enquiries (name,email,phone,message) VALUES (?,?,?,?)';

    conn.query(
        sql,
        [name, email, phone, message],
        (err) => {

            if (err) {
                console.error(err);
                return res.status(500).send(
                    'Unable to submit enquiry.'
                );
            }

            res.render('layout', {
                view: 'pages/success'
            });

        }
    );

});

//Save Calculation Route
app.post('/saveCalculation',
    requireLogin,
    (req, res) => {

        const userId = req.session.userId;

        const {
            loan_amount,
            interest_rate,
            term_years,
            monthly_payment,
            total_paid,
            total_interest
        } = req.body;

        const sql = `
        INSERT INTO saved_calculations
        (user_id, loan_amount, interest_rate,
        term_years, monthly_payment,
        total_paid, total_interest)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

        conn.query(
            sql,
            [
                userId,
                loan_amount,
                interest_rate,
                term_years,
                monthly_payment,
                total_paid,
                total_interest
            ],
            (err) => {

                if (err) throw err;

                res.send(
                    'Calculation saved successfully!'
                );

            }
        );

    });

//User Calculations - Show only logged-in user's calculations.
app.get(
    '/my-calculations',
    requireLogin,
    (req, res) => {

        const sql = `
            SELECT *
            FROM saved_calculations
            WHERE user_id = ?
            ORDER BY id DESC
        `;

        conn.query(
            sql,
            [req.session.userId],
            (err, results) => {

                if (err) throw err;

                res.render('layout', {
                    view: 'pages/my_calculations',
                    saved: results
                });

            }
        );

    });


// Admin Calculations - Admin sees everyone's calculations and user enquiries.
app.get(
    '/admin/saved',
    requireAdmin,
    (req, res) => {

        const sqlSaved = `
            SELECT sc.*,
                   u.name AS user_name,
                   u.email AS user_email
            FROM saved_calculations sc
            JOIN users u
            ON sc.user_id = u.id
            ORDER BY sc.id DESC
        `;

        // 1. Fetch saved calculations first
        conn.query(sqlSaved, (err, savedResults) => {
            if (err) throw err;

            const sqlEnquiries = 'SELECT * FROM enquiries ORDER BY id DESC';

            // 2. Fetch enquiries right after
            conn.query(sqlEnquiries, (err, enquiryResults) => {
                if (err) throw err;

                // 3. Send BOTH datasets to your existing template layout
                res.render('layout', {
                    view: 'pages/admin_saved',
                    saved: savedResults,
                    enquiries: enquiryResults // Passed cleanly to EJS
                });
            });
        });
    });

// Admin - Update Interest Rate
app.post('/admin/updateInterestRate',
    requireAdmin,
    (req, res) => {

        const {
            id,
            term,
            rate,
            lender
        } = req.body;

        if (!id || !term || !rate || !lender) {
            return res.status(400).send(
                'Please complete all fields.'
            );
        }

        const sql = `
            UPDATE interest_rate
            SET term = ?, rate = ?, lender = ?
            WHERE id = ?
        `;

        conn.query(
            sql,
            [term, rate, lender, id],
            (err) => {

                if (err) {
                    console.error(err);
                    return res.status(500).send(
                        'Unable to update interest rate.'
                    );
                }

                res.redirect('/ir');

            }
        );

    });

// Admin - Delete Interest Rate
app.post('/admin/deleteInterestRate',
    requireAdmin,
    (req, res) => {

        const { id } = req.body;

        if (!id) {
            return res.status(400).send(
                'Invalid interest rate.'
            );
        }

        const sql =
            'DELETE FROM interest_rate WHERE id = ?';

        conn.query(
            sql,
            [id],
            (err) => {

                if (err) {
                    console.error(err);
                    return res.status(500).send(
                        'Unable to delete interest rate.'
                    );
                }

                res.redirect('/ir');

            }
        );

    });
// Admin - Add Interest Rate
app.post('/admin/addInterestRate',
    requireAdmin,
    (req, res) => {

        const {
            term,
            rate,
            lender
        } = req.body;

        if (!term || !rate || !lender) {
            return res.status(400).send(
                'Please complete all fields.'
            );
        }

        const sql = `
            INSERT INTO interest_rate
            (term, rate, lender)
            VALUES (?, ?, ?)
        `;

        conn.query(
            sql,
            [term, rate, lender],
            (err) => {

                if (err) {
                    console.error(err);
                    return res.status(500).send(
                        'Unable to add interest rate.'
                    );
                }

                res.redirect('/ir');

            }
        );

    });
    
//Server Start
app.listen(4000);
console.log('Its running on port 4000');